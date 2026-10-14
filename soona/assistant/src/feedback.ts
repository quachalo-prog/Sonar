// ============================================================================
// ÉTAPE 2 — Boucle de feedback
// ----------------------------------------------------------------------------
// Ce qui est enregistré : le signal (👍 / 👎), une correction facultative, ET le contexte
// (question + réponse évaluée), le tout anonymisé, plus l'embedding de la question.
//
// Comment l'assistant « apprend » (sans ré-entraîner le modèle, ce qui n'est ni
// nécessaire ni possible via l'API) :
//   1. À chaud — avant chaque réponse, on cherche les retours portant sur des questions
//      proches et on les injecte comme « leçons » : corrections à appliquer, réponses
//      appréciées à imiter, réponses rejetées à éviter (voir prompt.ts).
//   2. À froid — scripts/export-dataset.ts exporte ces retours en jeu d'évaluation
//      pour mesurer chaque changement de prompt ou de modèle avant mise en production.
//
// Garde-fou anti-empoisonnement : un retour n'influence que SON auteur tant qu'un humain
// ne l'a pas validé (status = 'approved'). Sinon, n'importe qui pourrait « corriger »
// l'assistant pour tous les utilisateurs.
// ============================================================================

import { randomUUID } from "node:crypto";
import type { PiiRedactor, RedactOptions } from "./pii.js";
import type { Embedder, FeedbackRecord, FeedbackStore, MemoryStore, Rating } from "./types.js";

export class FeedbackError extends Error {
  constructor(public readonly status: 404 | 409, message: string) { super(message); }
}

export interface FeedbackInput {
  userId: string;
  messageId: string; // id de la réponse renvoyé par /chat
  rating: Rating;
  correction?: string | null;
}

export async function recordFeedback(
  deps: { memory: MemoryStore; feedback: FeedbackStore; embedder: Embedder; redactor: PiiRedactor },
  input: FeedbackInput,
  redactOpts: RedactOptions = {},
): Promise<FeedbackRecord> {
  // 1. La réponse doit exister ET appartenir à l'utilisateur (pas de vote sur la conversation d'un autre)
  const answer = await deps.memory.get(input.userId, input.messageId);
  if (!answer || answer.role !== "assistant") throw new FeedbackError(404, "Réponse introuvable");
  if (await deps.feedback.hasFeedback(input.userId, input.messageId)) throw new FeedbackError(409, "Vous avez déjà évalué cette réponse");

  // 2. Contexte : la question qui a produit cette réponse
  const question = await deps.memory.previousUserTurn(input.userId, answer.conversationId, answer.createdAt);
  if (!question) throw new FeedbackError(404, "Contexte introuvable");

  // 3. La correction est une saisie libre : on l'anonymise comme le reste
  const correctionRaw = input.correction?.trim() || null;
  const correction = correctionRaw ? (await deps.redactor.redact(correctionRaw, redactOpts)).text : null;

  // 4. On vectorise la QUESTION : c'est elle qu'on comparera aux futures questions
  const [questionEmbedding] = await deps.embedder.embed([question.content], "document");

  const record: FeedbackRecord = {
    id: randomUUID(),
    userId: input.userId,
    conversationId: answer.conversationId,
    messageId: answer.id,
    rating: input.rating,
    correction,
    question: question.content, // déjà anonymisée au moment du stockage
    answer: answer.content,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await deps.feedback.add(record, questionEmbedding ?? []);
  return record;
}
