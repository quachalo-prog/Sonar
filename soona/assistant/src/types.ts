// Contrats entre les briques. Chaque dépendance externe (LLM, embeddings, base vectorielle)
// est derrière une interface : on peut remplacer Supabase par Pinecone, ou Voyage par un autre
// fournisseur, sans toucher à la logique de l'assistant. Les tests utilisent des implémentations en mémoire.

import type Anthropic from "@anthropic-ai/sdk";

export type Role = "user" | "assistant";

/** Un tour de conversation tel qu'il est STOCKÉ : toujours anonymisé. */
export interface MemoryRecord {
  id: string;
  userId: string;
  conversationId: string;
  role: Role;
  content: string; // texte anonymisé (placeholders [EMAIL_1], [NOM_1]...)
  createdAt: string; // ISO
}

export interface ScoredMemory extends MemoryRecord {
  similarity: number; // 0..1 (cosinus)
}

export type Rating = 1 | -1;

/** Retour utilisateur rattaché à une réponse précise, avec le contexte nécessaire pour en tirer une leçon. */
export interface FeedbackRecord {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string; // id du MemoryRecord de la réponse évaluée
  rating: Rating;
  correction: string | null; // correction texte de l'utilisateur (anonymisée)
  question: string; // question à l'origine de la réponse (anonymisée)
  answer: string; // réponse évaluée (anonymisée)
  // Une leçon n'est utilisée pour TOUS les utilisateurs qu'après validation humaine (anti-empoisonnement).
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface ScoredFeedback extends FeedbackRecord {
  similarity: number;
}

export interface Embedder {
  /** "query" pour une recherche, "document" pour un texte stocké (les modèles Voyage les traitent différemment). */
  embed(texts: string[], kind: "query" | "document"): Promise<number[][]>;
}

export interface MemoryStore {
  add(record: MemoryRecord, embedding: number[]): Promise<void>;
  /** Rappel sémantique, limité à l'utilisateur (jamais de fuite entre comptes). */
  search(userId: string, embedding: number[], k: number, minSimilarity: number, excludeConversationId?: string): Promise<ScoredMemory[]>;
  recent(userId: string, conversationId: string, limit: number): Promise<MemoryRecord[]>;
  get(userId: string, messageId: string): Promise<MemoryRecord | null>;
  /** Le message utilisateur qui précède immédiatement une réponse donnée. */
  previousUserTurn(userId: string, conversationId: string, beforeCreatedAt: string): Promise<MemoryRecord | null>;
  deleteUser(userId: string): Promise<number>;
  exportUser(userId: string): Promise<MemoryRecord[]>;
  purgeOlderThan(isoDate: string): Promise<number>;
}

export interface FeedbackStore {
  add(record: FeedbackRecord, questionEmbedding: number[]): Promise<void>;
  /** Leçons pertinentes : celles de l'utilisateur + les leçons globales validées. */
  searchLessons(userId: string, embedding: number[], k: number, minSimilarity: number): Promise<ScoredFeedback[]>;
  hasFeedback(userId: string, messageId: string): Promise<boolean>;
  deleteUser(userId: string): Promise<number>;
  exportUser(userId: string): Promise<FeedbackRecord[]>;
  listForDataset(sinceIso?: string): Promise<FeedbackRecord[]>;
  /** Modération : valide une leçon pour tous les utilisateurs, ou la rejette. */
  setStatus(id: string, status: FeedbackRecord["status"]): Promise<boolean>;
}

/** Ce que l'assistant envoie au LLM, indépendamment du fournisseur. */
export interface LlmRequest {
  system: string;
  messages: Anthropic.MessageParam[];
}

export interface LlmResponse {
  text: string;
  refused: boolean;
  model: string;
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}
