// Appel au LLM (Claude). Isolé derrière LlmClient pour pouvoir changer de fournisseur ou tester sans réseau.

import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmRequest, LlmResponse } from "./types.js";

export class ClaudeClient implements LlmClient {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly effort: "low" | "medium" | "high" | "xhigh" | "max",
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      // Réflexion adaptative (toujours active sur ce modèle) ; « low » suffit pour du chat et réduit coût et latence.
      output_config: { effort: this.effort },
      // Repli côté serveur : si le filtre de sécurité refuse, Anthropic relance sur le modèle de secours recommandé.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Prompt système identique d'une requête à l'autre : marqué pour le cache. Il ne sera réellement mis en cache
      // qu'une fois au-dessus de la taille minimale du modèle (quelques milliers de tokens), par ex. si vous y ajoutez
      // une FAQ ou le catalogue des services. Vérifier avec usage.cache_read_input_tokens.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: req.messages,
    });

    // Toujours vérifier stop_reason AVANT de lire le contenu.
    if (res.stop_reason === "refusal") return { text: "", refused: true, model: res.model };
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    return { text, refused: false, model: res.model };
  }
}

/** Erreurs à exposer au client sans fuiter de détails internes. */
export function describeLlmError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.RateLimitError) return { status: 429, message: "Assistant saturé, réessayez dans un instant." };
  if (err instanceof Anthropic.APIConnectionError) return { status: 503, message: "Assistant momentanément injoignable." };
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return { status: 503, message: "Assistant momentanément indisponible." };
  if (err instanceof Anthropic.APIError) return { status: 502, message: "Requête refusée par le service d'IA." };
  return { status: 500, message: "Erreur interne." };
}
