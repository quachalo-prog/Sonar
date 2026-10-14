// ============================================================================
// ÉTAPE 1 — Mémoire de conversation
// ----------------------------------------------------------------------------
// Deux niveaux de mémoire, combinés avant chaque appel au LLM :
//   • Mémoire courte : les N derniers tours de la conversation en cours (ordre chronologique).
//   • Mémoire longue : les tours passés (toutes conversations de CET utilisateur) les plus
//     proches sémantiquement de la question, retrouvés par recherche vectorielle.
// On y ajoute les « leçons » issues du feedback (voir feedback.ts) : c'est la boucle d'apprentissage.
// ============================================================================

import { randomUUID } from "node:crypto";
import type { Embedder, FeedbackStore, MemoryRecord, MemoryStore, Role, ScoredFeedback, ScoredMemory } from "./types.js";

export interface RecalledContext {
  recent: MemoryRecord[]; // mémoire courte
  recalled: ScoredMemory[]; // mémoire longue (hors tours déjà présents dans la mémoire courte)
  lessons: ScoredFeedback[]; // leçons tirées des retours utilisateurs
}

export interface RetrieveParams {
  userId: string;
  conversationId: string;
  queryEmbedding: number[]; // embedding de la question ANONYMISÉE
  topK: number;
  minSimilarity: number;
  recentTurns: number;
}

/** Récupère tout le contexte utile en parallèle (3 requêtes indépendantes). */
export async function retrieveContext(memory: MemoryStore, feedback: FeedbackStore, p: RetrieveParams): Promise<RecalledContext> {
  const [recent, similar, lessons] = await Promise.all([
    memory.recent(p.userId, p.conversationId, p.recentTurns),
    // On demande un peu plus que topK pour compenser les doublons retirés juste après
    memory.search(p.userId, p.queryEmbedding, p.topK + p.recentTurns, p.minSimilarity),
    feedback.searchLessons(p.userId, p.queryEmbedding, 3, p.minSimilarity),
  ]);
  const inRecent = new Set(recent.map((m) => m.id));
  const recalled = similar.filter((m) => !inRecent.has(m.id)).slice(0, p.topK);
  return { recent, recalled, lessons };
}

/**
 * Enregistre un échange (question + réponse) déjà anonymisé.
 * Les deux textes sont vectorisés en un seul appel. Renvoie l'id de la réponse,
 * que le front renverra avec le pouce en l'air / en bas.
 */
export async function rememberExchange(
  memory: MemoryStore,
  embedder: Embedder,
  e: { userId: string; conversationId: string; question: string; answer: string | null },
): Promise<{ questionId: string; answerId: string | null }> {
  const now = Date.now();
  const turns: { role: Role; content: string }[] = [{ role: "user", content: e.question }];
  if (e.answer) turns.push({ role: "assistant", content: e.answer });
  const vectors = await embedder.embed(turns.map((t) => t.content), "document");

  const ids: string[] = [];
  for (const [i, t] of turns.entries()) {
    const id = randomUUID();
    ids.push(id);
    // +i ms : garantit l'ordre question → réponse pour la mémoire courte
    await memory.add({ id, userId: e.userId, conversationId: e.conversationId, role: t.role, content: t.content, createdAt: new Date(now + i).toISOString() }, vectors[i] ?? []);
  }
  return { questionId: ids[0] ?? "", answerId: ids[1] ?? null };
}
