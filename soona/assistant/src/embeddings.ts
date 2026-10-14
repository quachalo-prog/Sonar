// Embeddings : transforment un texte en vecteur pour la recherche sémantique.
// Anthropic ne fournit pas de modèle d'embeddings ; Voyage AI est le partenaire recommandé.
// Seul du texte DÉJÀ anonymisé est envoyé ici.

import { VoyageAIClient } from "voyageai";
import type { Embedder } from "./types.js";

export class VoyageEmbedder implements Embedder {
  private readonly client: VoyageAIClient;

  constructor(private readonly model: string, private readonly dimension: number, apiKey = process.env.VOYAGE_API_KEY) {
    if (!apiKey) throw new Error("VOYAGE_API_KEY manquante");
    this.client = new VoyageAIClient({ apiKey });
  }

  async embed(texts: string[], kind: "query" | "document"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.client.embed({
      input: texts,
      model: this.model,
      inputType: kind, // « query » pour chercher, « document » pour stocker : meilleure précision de rappel
      outputDimension: this.dimension, // doit correspondre à vector(N) dans la base
    });
    const data = [...(res.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (data.length !== texts.length) throw new Error("Réponse d'embeddings incomplète");
    return data.map((d) => d.embedding ?? []);
  }
}
