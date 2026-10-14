// Implémentation production : Supabase (PostgreSQL + pgvector).
// Utilise la clé service_role → ce fichier ne doit tourner QUE côté serveur.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FeedbackRecord, FeedbackStore, MemoryRecord, MemoryStore, ScoredFeedback, ScoredMemory } from "../types.js";

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");

function toMemory(r: Row): MemoryRecord {
  return { id: s(r.id), userId: s(r.user_id), conversationId: s(r.conversation_id), role: r.role === "assistant" ? "assistant" : "user", content: s(r.content), createdAt: s(r.created_at) };
}
function toFeedback(r: Row): FeedbackRecord {
  return {
    id: s(r.id), userId: s(r.user_id), conversationId: s(r.conversation_id), messageId: s(r.message_id),
    rating: Number(r.rating) === 1 ? 1 : -1, correction: r.correction == null ? null : s(r.correction),
    question: s(r.question), answer: s(r.answer),
    status: r.status === "approved" ? "approved" : r.status === "rejected" ? "rejected" : "pending",
    createdAt: s(r.created_at),
  };
}
function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Supabase (${what}) : ${res.error.message}`);
  return res.data;
}

export function createSupabase(url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY): SupabaseClient {
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class SupabaseMemoryStore implements MemoryStore {
  constructor(private readonly db: SupabaseClient) {}

  async add(r: MemoryRecord, embedding: number[]) {
    check(await this.db.from("assistant_memories").insert({
      id: r.id, user_id: r.userId, conversation_id: r.conversationId, role: r.role, content: r.content, created_at: r.createdAt, embedding,
    }), "insert memory");
  }
  async search(userId: string, embedding: number[], k: number, minSimilarity: number, excludeConversationId?: string): Promise<ScoredMemory[]> {
    const rows = check(await this.db.rpc("match_memories", {
      p_user_id: userId, p_query: embedding, p_k: k, p_min_similarity: minSimilarity, p_exclude_conversation: excludeConversationId ?? null,
    }), "match_memories") as Row[] | null;
    return (rows ?? []).map((r) => ({ ...toMemory(r), similarity: Number(r.similarity) }));
  }
  async recent(userId: string, conversationId: string, limit: number) {
    const rows = check(await this.db.from("assistant_memories").select("id,user_id,conversation_id,role,content,created_at")
      .eq("user_id", userId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(limit), "recent");
    return (rows ?? []).map(toMemory).reverse();
  }
  async get(userId: string, messageId: string) {
    const rows = check(await this.db.from("assistant_memories").select("id,user_id,conversation_id,role,content,created_at")
      .eq("user_id", userId).eq("id", messageId).limit(1), "get");
    return rows?.[0] ? toMemory(rows[0]) : null;
  }
  async previousUserTurn(userId: string, conversationId: string, beforeCreatedAt: string) {
    const rows = check(await this.db.from("assistant_memories").select("id,user_id,conversation_id,role,content,created_at")
      .eq("user_id", userId).eq("conversation_id", conversationId).eq("role", "user").lt("created_at", beforeCreatedAt)
      .order("created_at", { ascending: false }).limit(1), "previousUserTurn");
    return rows?.[0] ? toMemory(rows[0]) : null;
  }
  async deleteUser(userId: string) {
    const rows = check(await this.db.from("assistant_memories").delete().eq("user_id", userId).select("id"), "delete memories");
    return rows?.length ?? 0;
  }
  async exportUser(userId: string) {
    const rows = check(await this.db.from("assistant_memories").select("id,user_id,conversation_id,role,content,created_at")
      .eq("user_id", userId).order("created_at"), "export memories");
    return (rows ?? []).map(toMemory);
  }
  async purgeOlderThan(isoDate: string) {
    return Number(check(await this.db.rpc("purge_assistant_memories", { p_before: isoDate }), "purge"));
  }
}

export class SupabaseFeedbackStore implements FeedbackStore {
  constructor(private readonly db: SupabaseClient) {}

  async add(r: FeedbackRecord, questionEmbedding: number[]) {
    check(await this.db.from("assistant_feedback").insert({
      id: r.id, user_id: r.userId, conversation_id: r.conversationId, message_id: r.messageId, rating: r.rating,
      correction: r.correction, question: r.question, answer: r.answer, status: r.status, created_at: r.createdAt,
      question_embedding: questionEmbedding,
    }), "insert feedback");
  }
  async searchLessons(userId: string, embedding: number[], k: number, minSimilarity: number): Promise<ScoredFeedback[]> {
    const rows = check(await this.db.rpc("match_lessons", { p_user_id: userId, p_query: embedding, p_k: k, p_min_similarity: minSimilarity }), "match_lessons") as Row[] | null;
    return (rows ?? []).map((r) => ({ ...toFeedback(r), similarity: Number(r.similarity) }));
  }
  async hasFeedback(userId: string, messageId: string) {
    const rows = check(await this.db.from("assistant_feedback").select("id").eq("user_id", userId).eq("message_id", messageId).limit(1), "hasFeedback");
    return (rows?.length ?? 0) > 0;
  }
  async deleteUser(userId: string) {
    const rows = check(await this.db.from("assistant_feedback").delete().eq("user_id", userId).select("id"), "delete feedback");
    return rows?.length ?? 0;
  }
  async exportUser(userId: string) {
    const rows = check(await this.db.from("assistant_feedback").select("id,user_id,conversation_id,message_id,rating,correction,question,answer,status,created_at")
      .eq("user_id", userId).order("created_at"), "export feedback");
    return (rows ?? []).map(toFeedback);
  }
  async listForDataset(sinceIso?: string) {
    let q = this.db.from("assistant_feedback").select("id,user_id,conversation_id,message_id,rating,correction,question,answer,status,created_at").neq("status", "rejected");
    if (sinceIso) q = q.gte("created_at", sinceIso);
    const rows = check(await q.order("created_at"), "dataset");
    return (rows ?? []).map(toFeedback);
  }
  async setStatus(id: string, status: FeedbackRecord["status"]) {
    const rows = check(await this.db.from("assistant_feedback").update({ status }).eq("id", id).select("id"), "setStatus");
    return (rows?.length ?? 0) > 0;
  }
}
