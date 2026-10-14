// Boucle d'apprentissage « à froid » : transforme les retours utilisateurs en jeu d'évaluation (JSONL).
//
// Usage :  npm run export-dataset -- [--since 2026-01-01] [--out dataset.jsonl]
//
// Chaque ligne = un cas de test : la question, la réponse donnée, le verdict, et la réponse attendue
// quand l'utilisateur a fourni une correction. Avant de changer le prompt système, le modèle ou les
// réglages de mémoire, on rejoue ces cas et on compare : on améliore en mesurant, pas à l'intuition.
// Les textes sont déjà anonymisés en base ; aucun user_id n'est exporté.

import { writeFileSync } from "node:fs";
import { createSupabase, SupabaseFeedbackStore } from "../src/stores/supabase.js";
import type { FeedbackRecord } from "../src/types.js";

export function toDatasetLine(f: FeedbackRecord) {
  return {
    id: f.id,
    question: f.question,
    answer: f.answer,
    verdict: f.rating === 1 ? "good" : "bad",
    expected: f.correction, // null si simple pouce, sans correction
    validated: f.status === "approved",
    date: f.createdAt.slice(0, 10),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const since = args[args.indexOf("--since") + 1] && args.includes("--since") ? args[args.indexOf("--since") + 1] : undefined;
  const out = args.includes("--out") ? (args[args.indexOf("--out") + 1] ?? "dataset.jsonl") : "dataset.jsonl";
  const rows = await new SupabaseFeedbackStore(createSupabase()).listForDataset(since);
  writeFileSync(out, rows.map((r) => JSON.stringify(toDatasetLine(r))).join("\n") + "\n");
  const bad = rows.filter((r) => r.rating === -1).length;
  console.log(`${rows.length} cas exportés dans ${out} (${bad} négatifs, ${rows.filter((r) => r.correction).length} avec correction)`);
}

if (process.argv[1]?.endsWith("export-dataset.ts")) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
