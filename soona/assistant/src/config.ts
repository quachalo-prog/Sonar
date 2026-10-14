// Configuration centralisée, lue une seule fois au démarrage.
// Les secrets viennent de l'environnement : jamais en dur, jamais côté navigateur.

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  claudeEffort: (process.env.CLAUDE_EFFORT ?? "low") as "low" | "medium" | "high" | "xhigh" | "max",
  voyageModel: process.env.VOYAGE_MODEL ?? "voyage-3.5",
  embeddingDim: num(process.env.EMBEDDING_DIM, 1024),
  memoryTopK: num(process.env.MEMORY_TOP_K, 6),
  memoryMinSimilarity: num(process.env.MEMORY_MIN_SIMILARITY, 0.75),
  memoryRetentionDays: num(process.env.MEMORY_RETENTION_DAYS, 180),
  // Nombre de tours récents de la conversation en cours (mémoire courte), en plus du rappel vectoriel (mémoire longue)
  recentTurns: num(process.env.RECENT_TURNS, 8),
  piiLlmDetection: process.env.PII_LLM_DETECTION === "true",
  port: num(process.env.PORT, 8787),
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? "http://localhost:5173",
};
