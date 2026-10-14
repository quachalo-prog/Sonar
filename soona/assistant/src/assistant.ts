// ============================================================================
// Orchestrateur : relie anonymisation → mémoire → LLM → stockage → feedback.
//
//   message brut ──► [3] anonymisation ──► embedding (query)
//                                             │
//                       ┌─────────────────────┴───────────────────┐
//                  [1] mémoire courte + longue              [2] leçons (feedback)
//                       └─────────────────────┬───────────────────┘
//                                       prompt ──► Claude
//                                             │
//              réponse ──► ré-anonymisée ──► stockée (+ embedding document)
//                     └──► réhydratée (vraies valeurs) ──► affichée à l'utilisateur
// ============================================================================

import { randomUUID } from "node:crypto";
import { recordFeedback, type FeedbackInput } from "./feedback.js";
import { rememberExchange, retrieveContext } from "./memory.js";
import { restore, type PiiRedactor, type RedactOptions } from "./pii.js";
import { buildPrompt } from "./prompt.js";
import type { Embedder, FeedbackRecord, FeedbackStore, LlmClient, MemoryRecord, MemoryStore } from "./types.js";

export interface AssistantDeps {
  llm: LlmClient;
  embedder: Embedder;
  memory: MemoryStore;
  feedback: FeedbackStore;
  redactor: PiiRedactor;
  /** Noms publics à ne pas masquer (fiches des pros). */
  publicNames?: () => Promise<string[]>;
  settings: { topK: number; minSimilarity: number; recentTurns: number; retentionDays: number };
}

export interface ChatInput {
  userId: string;
  conversationId?: string;
  message: string;
  /** Nom du profil : toujours masqué, même sans indice du type « je m'appelle ». */
  profileName?: string;
}

export interface ChatOutput {
  conversationId: string;
  messageId: string | null; // à renvoyer avec le feedback ; null si la demande a été refusée
  reply: string;
  refused: boolean;
  memory: { recent: number; recalled: number; lessons: number }; // pour le débogage et la transparence
}

export const MAX_MESSAGE_CHARS = 4000;
const REFUSAL_REPLY = "Je ne peux pas vous aider sur ce point. Je peux en revanche vous aider à trouver un professionnel ou à préparer un rendez-vous.";

export class Assistant {
  constructor(private readonly d: AssistantDeps) {}

  private async redactOpts(profileName?: string): Promise<RedactOptions> {
    return { knownNames: profileName ? [profileName] : [], publicNames: (await this.d.publicNames?.()) ?? [] };
  }

  async chat(input: ChatInput): Promise<ChatOutput> {
    const conversationId = input.conversationId ?? randomUUID();
    const opts = await this.redactOpts(input.profileName);

    // [3] Anonymisation AVANT tout : le LLM, les embeddings et la base ne voient que des marqueurs
    const { text: question, mapping } = await this.d.redactor.redact(input.message, opts);

    // [1] + [2] Rappel : mémoire courte, mémoire longue et leçons, en parallèle
    const [queryEmbedding] = await this.d.embedder.embed([question], "query");
    const ctx = await retrieveContext(this.d.memory, this.d.feedback, {
      userId: input.userId, conversationId, queryEmbedding: queryEmbedding ?? [],
      topK: this.d.settings.topK, minSimilarity: this.d.settings.minSimilarity, recentTurns: this.d.settings.recentTurns,
    });

    // Appel au LLM avec le contexte injecté
    const res = await this.d.llm.complete(buildPrompt(ctx, question));
    const stats = { recent: ctx.recent.length, recalled: ctx.recalled.length, lessons: ctx.lessons.length };

    if (res.refused || !res.text) {
      // On garde la question pour la continuité de la conversation, pas la réponse vide
      await rememberExchange(this.d.memory, this.d.embedder, { userId: input.userId, conversationId, question, answer: null });
      return { conversationId, messageId: null, reply: REFUSAL_REPLY, refused: true, memory: stats };
    }

    // La réponse peut contenir des données personnelles nouvelles : on la ré-anonymise avant stockage,
    // avec le même mapping pour que [NOM_1] reste [NOM_1].
    const stored = (await this.d.redactor.redact(res.text, opts, mapping)).text;
    const { answerId } = await rememberExchange(this.d.memory, this.d.embedder, { userId: input.userId, conversationId, question, answer: stored });

    // Affichage : les marqueurs redeviennent les vraies valeurs, puis le mapping est jeté (fin de portée)
    return { conversationId, messageId: answerId, reply: restore(res.text, mapping), refused: false, memory: stats };
  }

  async feedback(input: FeedbackInput & { profileName?: string }): Promise<FeedbackRecord> {
    return recordFeedback(this.d, input, await this.redactOpts(input.profileName));
  }

  /** Modération humaine d'une leçon (garde-fou anti-empoisonnement). */
  async setLessonStatus(id: string, status: FeedbackRecord["status"]): Promise<boolean> {
    return this.d.feedback.setStatus(id, status);
  }

  /** RGPD art. 17 — droit à l'effacement : supprime mémoire et retours de l'utilisateur. */
  async forget(userId: string): Promise<{ memories: number; feedback: number }> {
    const feedback = await this.d.feedback.deleteUser(userId);
    const memories = await this.d.memory.deleteUser(userId);
    return { memories, feedback };
  }

  /** RGPD art. 15 / 20 — droit d'accès et portabilité. */
  async export(userId: string): Promise<{ memories: MemoryRecord[]; feedback: FeedbackRecord[] }> {
    const [memories, feedback] = await Promise.all([this.d.memory.exportUser(userId), this.d.feedback.exportUser(userId)]);
    return { memories, feedback };
  }

  /** RGPD — limitation de conservation : à appeler chaque jour (cron) si pg_cron n'est pas utilisé. */
  async purgeExpired(now = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - this.d.settings.retentionDays * 864e5).toISOString();
    return this.d.memory.purgeOlderThan(limit);
  }
}
