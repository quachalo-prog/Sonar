// API HTTP de l'assistant (Express 5).
//
//   POST   /api/assistant/chat         { message, conversationId? }            → réponse + messageId
//   POST   /api/assistant/feedback     { messageId, rating: 1|-1, correction? } → 201
//   GET    /api/assistant/memory       export RGPD (accès / portabilité)
//   DELETE /api/assistant/memory       effacement RGPD
//   PATCH  /api/assistant/lessons/:id  { status } — modération, réservée à l'admin
//
// L'identité vient TOUJOURS du jeton vérifié côté serveur, jamais du corps de la requête :
// un client ne peut pas lire ni noter la mémoire d'un autre en changeant un userId.

import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { Assistant, MAX_MESSAGE_CHARS } from "./assistant.js";
import { config } from "./config.js";
import { VoyageEmbedder } from "./embeddings.js";
import { FeedbackError } from "./feedback.js";
import { ClaudeClient, describeLlmError } from "./llm.js";
import { ClaudeNameDetector, PiiRedactor } from "./pii.js";
import { createSupabase, SupabaseFeedbackStore, SupabaseMemoryStore } from "./stores/supabase.js";

export interface AuthUser { id: string; name?: string }
/** Vérifie le jeton et renvoie l'utilisateur, ou null. Injecté pour pouvoir tester sans Supabase. */
export type Authenticate = (bearerToken: string) => Promise<AuthUser | null>;

const ChatBody = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  conversationId: z.uuid().optional(),
});
const FeedbackBody = z.object({
  messageId: z.uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  correction: z.string().trim().max(2000).optional(),
});
const LessonBody = z.object({ status: z.enum(["approved", "rejected", "pending"]) });

/** Limitation simple par utilisateur (fenêtre glissante). En multi-instance : Redis ou passerelle API. */
function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    return recent.length <= max;
  };
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createApp(assistant: Assistant, authenticate: Authenticate, opts: { allowedOrigin: string; adminToken?: string }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  // CORS : uniquement l'origine du front Soona
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", opts.allowedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });

  const allowChat = rateLimiter(20, 60_000);
  const allowOther = rateLimiter(60, 60_000);

  // Authentification : jeton « Bearer » vérifié par Supabase Auth
  const requireUser = async (req: Request, res: Response, next: NextFunction) => {
    const token = req.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    const user = token ? await authenticate(token).catch(() => null) : null;
    if (!user) { res.status(401).json({ error: "Authentification requise" }); return; }
    res.locals.user = user;
    next();
  };
  const user = (res: Response) => res.locals.user as AuthUser;

  app.post("/api/assistant/chat", requireUser, async (req, res) => {
    if (!allowChat(user(res).id)) { res.status(429).json({ error: "Trop de messages, patientez une minute." }); return; }
    const body = ChatBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "Message invalide" }); return; }
    try {
      const out = await assistant.chat({ userId: user(res).id, profileName: user(res).name, ...body.data });
      res.json(out);
    } catch (err) {
      const { status, message } = describeLlmError(err);
      // Journalisation sans contenu de message : jamais de données personnelles dans les logs
      console.error("[chat]", status, err instanceof Error ? err.name : "unknown");
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/assistant/feedback", requireUser, async (req, res) => {
    if (!allowOther(user(res).id)) { res.status(429).json({ error: "Trop de requêtes" }); return; }
    const body = FeedbackBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "Feedback invalide" }); return; }
    try {
      const f = await assistant.feedback({ userId: user(res).id, profileName: user(res).name, ...body.data });
      res.status(201).json({ id: f.id, status: f.status });
    } catch (err) {
      if (err instanceof FeedbackError) { res.status(err.status).json({ error: err.message }); return; }
      console.error("[feedback]", err instanceof Error ? err.name : "unknown");
      res.status(500).json({ error: "Erreur interne" });
    }
  });

  app.get("/api/assistant/memory", requireUser, async (_req, res) => {
    res.setHeader("Content-Disposition", 'attachment; filename="soona-assistant-mes-donnees.json"');
    res.json(await assistant.export(user(res).id));
  });

  app.delete("/api/assistant/memory", requireUser, async (_req, res) => {
    res.json({ deleted: await assistant.forget(user(res).id) });
  });

  // Modération des leçons : un humain décide ce qui s'applique à tous les utilisateurs
  app.patch("/api/assistant/lessons/:id", async (req, res) => {
    const token = req.get("x-admin-token") ?? "";
    if (!opts.adminToken || !safeEqual(token, opts.adminToken)) { res.status(403).json({ error: "Accès refusé" }); return; }
    const body = LessonBody.safeParse(req.body);
    const id = z.uuid().safeParse(req.params.id);
    if (!body.success || !id.success) { res.status(400).json({ error: "Requête invalide" }); return; }
    const ok = await assistant.setLessonStatus(id.data, body.data.status);
    res.status(ok ? 200 : 404).json(ok ? { id: id.data, status: body.data.status } : { error: "Leçon introuvable" });
  });

  // Gestionnaire d'erreurs final : aucune trace interne renvoyée au client
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[http]", err instanceof Error ? err.name : "unknown");
    res.status(500).json({ error: "Erreur interne" });
  });
  return app;
}

/** Câblage production : Claude + Voyage + Supabase. */
export function buildProductionAssistant() {
  const anthropic = new Anthropic(); // lit ANTHROPIC_API_KEY
  const db = createSupabase();
  const assistant = new Assistant({
    llm: new ClaudeClient(anthropic, config.claudeModel, config.claudeEffort),
    embedder: new VoyageEmbedder(config.voyageModel, config.embeddingDim),
    memory: new SupabaseMemoryStore(db),
    feedback: new SupabaseFeedbackStore(db),
    redactor: new PiiRedactor(config.piiLlmDetection ? new ClaudeNameDetector(anthropic, config.claudeModel) : undefined),
    // Noms des pros (publics) : ne pas les masquer. Adapter la table/colonne à votre schéma.
    publicNames: async () => {
      const { data } = await db.from("pros").select("name");
      return (data ?? []).map((r: { name: string }) => r.name);
    },
    settings: { topK: config.memoryTopK, minSimilarity: config.memoryMinSimilarity, recentTurns: config.recentTurns, retentionDays: config.memoryRetentionDays },
  });
  // Vérification du jeton par Supabase Auth ; le nom vient des métadonnées du compte
  const authenticate: Authenticate = async (token) => {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return null;
    const meta = data.user.user_metadata as { full_name?: string; name?: string } | undefined;
    return { id: data.user.id, name: meta?.full_name ?? meta?.name };
  };
  return { assistant, authenticate };
}

// Démarrage seulement si le fichier est lancé directement (pas lors des tests)
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { assistant, authenticate } = buildProductionAssistant();
  const app = createApp(assistant, authenticate, { allowedOrigin: config.allowedOrigin, adminToken: process.env.ADMIN_TOKEN });
  app.listen(config.port, () => console.log(`Assistant Soona sur :${config.port}`));
  // Purge quotidienne (si pg_cron n'est pas activé dans Supabase)
  setInterval(() => assistant.purgeExpired().catch(() => console.error("[purge] échec")), 24 * 3600_000).unref();
}
