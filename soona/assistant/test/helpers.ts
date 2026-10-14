// Doubles de test : embeddings déterministes (sac de mots haché) et LLM factice qui enregistre ses requêtes.
import { createHash } from "node:crypto";
import { Assistant } from "../src/assistant.js";
import { PiiRedactor } from "../src/pii.js";
import { InMemoryFeedbackStore, InMemoryMemoryStore } from "../src/stores/in-memory.js";
import type { Embedder, LlmClient, LlmRequest, LlmResponse } from "../src/types.js";

export class FakeEmbedder implements Embedder {
  readonly inputs: string[] = [];
  async embed(texts: string[]) {
    this.inputs.push(...texts);
    return texts.map((t) => {
      const v = new Array<number>(256).fill(0);
      for (const w of t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z]{4,}/g) ?? []) {
        const i = createHash("md5").update(w).digest()[0] ?? 0;
        v[i] = (v[i] ?? 0) + 1;
      }
      return v;
    });
  }
}

export class FakeLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  reply: (req: LlmRequest) => string = () => "Réponse de test.";
  refuse = false;
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    return this.refuse ? { text: "", refused: true, model: "fake" } : { text: this.reply(req), refused: false, model: "fake" };
  }
  lastPrompt(): string {
    const req = this.requests[this.requests.length - 1]!;
    return req.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n---\n");
  }
}

export function makeAssistant(publicNames: string[] = []) {
  const llm = new FakeLlm();
  const embedder = new FakeEmbedder();
  const memory = new InMemoryMemoryStore();
  const feedback = new InMemoryFeedbackStore();
  const assistant = new Assistant({
    llm, embedder, memory, feedback, redactor: new PiiRedactor(),
    publicNames: async () => publicNames,
    settings: { topK: 6, minSimilarity: 0.3, recentTurns: 8, retentionDays: 180 },
  });
  return { assistant, llm, embedder, memory, feedback };
}

export const ALICE = "11111111-1111-4111-8111-111111111111";
export const BOB = "22222222-2222-4222-8222-222222222222";
