// Implémentation en mémoire (tests, démo locale). Même comportement que la version Supabase,
// y compris l'isolation par utilisateur et la règle « leçons globales = validées uniquement ».

import type { FeedbackRecord, FeedbackStore, MemoryRecord, MemoryStore, ScoredFeedback, ScoredMemory } from "../types.js";

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; dot += x * y; na += x * x; nb += y * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export class InMemoryMemoryStore implements MemoryStore {
  readonly rows: { r: MemoryRecord; e: number[] }[] = [];
  async add(r: MemoryRecord, e: number[]) { this.rows.push({ r, e }); }
  async search(userId: string, q: number[], k: number, min: number, exclude?: string): Promise<ScoredMemory[]> {
    return this.rows.filter(({ r }) => r.userId === userId && r.conversationId !== exclude)
      .map(({ r, e }) => ({ ...r, similarity: cosine(q, e) })).filter((m) => m.similarity >= min)
      .sort((a, b) => b.similarity - a.similarity).slice(0, k);
  }
  async recent(userId: string, conv: string, limit: number) {
    return this.rows.map((x) => x.r).filter((r) => r.userId === userId && r.conversationId === conv).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-limit);
  }
  async get(userId: string, id: string) { return this.rows.find(({ r }) => r.userId === userId && r.id === id)?.r ?? null; }
  async previousUserTurn(userId: string, conv: string, before: string) {
    return this.rows.map((x) => x.r).filter((r) => r.userId === userId && r.conversationId === conv && r.role === "user" && r.createdAt < before)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }
  async deleteUser(userId: string) { const n = this.rows.length; this.rows.splice(0, n, ...this.rows.filter(({ r }) => r.userId !== userId)); return n - this.rows.length; }
  async exportUser(userId: string) { return this.rows.map((x) => x.r).filter((r) => r.userId === userId); }
  async purgeOlderThan(iso: string) { const n = this.rows.length; this.rows.splice(0, n, ...this.rows.filter(({ r }) => r.createdAt >= iso)); return n - this.rows.length; }
}

export class InMemoryFeedbackStore implements FeedbackStore {
  readonly rows: { r: FeedbackRecord; e: number[] }[] = [];
  async add(r: FeedbackRecord, e: number[]) { this.rows.push({ r, e }); }
  async searchLessons(userId: string, q: number[], k: number, min: number): Promise<ScoredFeedback[]> {
    return this.rows.filter(({ r }) => r.status !== "rejected" && (r.userId === userId || r.status === "approved"))
      .map(({ r, e }) => ({ ...r, similarity: cosine(q, e) })).filter((f) => f.similarity >= min)
      .sort((a, b) => b.similarity - a.similarity).slice(0, k);
  }
  async hasFeedback(userId: string, messageId: string) { return this.rows.some(({ r }) => r.userId === userId && r.messageId === messageId); }
  async deleteUser(userId: string) { const n = this.rows.length; this.rows.splice(0, n, ...this.rows.filter(({ r }) => r.userId !== userId)); return n - this.rows.length; }
  async exportUser(userId: string) { return this.rows.map((x) => x.r).filter((r) => r.userId === userId); }
  async listForDataset(since?: string) { return this.rows.map((x) => x.r).filter((r) => r.status !== "rejected" && (!since || r.createdAt >= since)); }
  async setStatus(id: string, status: FeedbackRecord["status"]) { const row = this.rows.find(({ r }) => r.id === id); if (row) row.r.status = status; return !!row; }
}
