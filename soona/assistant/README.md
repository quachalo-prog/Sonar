# Assistant Soona — mémoire, boucle de feedback et anonymisation RGPD

Service Node.js/TypeScript qui transforme un chatbot sans état en assistant qui **se souvient** des échanges passés et **s'améliore** grâce aux retours des utilisateurs, sans jamais stocker de données personnelles en clair.

| Brique | Choix | Remplaçable par |
|---|---|---|
| Langage | Node.js 20+ / TypeScript | — |
| LLM | Claude (`claude-opus-5-5`, effort `low` pour le chat) via `@anthropic-ai/sdk` | toute classe implémentant `LlmClient` |
| Orchestration | sans framework (≈ 1 000 lignes commentées) | LangChain / LlamaIndex si besoin |
| Embeddings | Voyage AI `voyage-3.5` (1024 dimensions) | toute classe implémentant `Embedder` |
| Base vectorielle | Supabase pgvector (index HNSW, distance cosinus) | Pinecone, Weaviate… via `MemoryStore` / `FeedbackStore` |

## Architecture

```
message brut ──► [3] anonymisation (pii.ts) ──► embedding « query »
                                                   │
                     ┌─────────────────────────────┴──────────────────────────┐
             [1] mémoire courte (N derniers tours)                 [2] leçons issues du feedback
                 + mémoire longue (recherche vectorielle)              (correction / 👍 / 👎)
                     └─────────────────────────────┬──────────────────────────┘
                                         prompt (prompt.ts) ──► Claude
                                                   │
                réponse ──► ré-anonymisée ──► stockée + vectorisée (memory.ts)
                       └──► réhydratée (vraies valeurs) ──► affichée
```

| Fichier | Rôle |
|---|---|
| `src/pii.ts` | **Étape 3** : anonymisation (email, téléphone, IBAN, carte, n° de sécu, IP, noms) et réhydratation |
| `src/memory.ts` | **Étape 1** : récupération mémoire courte + longue + leçons, enregistrement des échanges |
| `src/feedback.ts` | **Étape 2** : enregistrement du 👍/👎 et de la correction avec le contexte |
| `src/prompt.ts` | Injection de la mémoire et des leçons dans le prompt (protégée contre l'injection) |
| `src/assistant.ts` | Orchestrateur qui relie tout, plus export / effacement / purge RGPD |
| `src/server.ts` | API HTTP : authentification, validation, limitation de débit, CORS |
| `src/llm.ts`, `src/embeddings.ts` | Clients Claude et Voyage |
| `src/stores/` | Supabase (production) et en mémoire (tests) |
| `supabase/migrations/001_assistant_memory.sql` | Tables, index HNSW, fonctions de recherche, RLS, purge |
| `scripts/export-dataset.ts` | Boucle « à froid » : retours → jeu d'évaluation JSONL |
| `client/soona-assistant.js` | Client navigateur (envoi, 👍/👎, export, effacement) |

## Installation pas à pas

### 1. Paquets

```bash
cd soona/assistant
npm install @anthropic-ai/sdk@0.134.0 @supabase/supabase-js@2.117.3 express@5.3.0 zod@4.6.7 voyageai@0.4.0
npm install -D typescript@7.0.2 tsx@4.23.15 @types/express@5.0.6 @types/node@26.6.5
```

(Ou simplement `npm install`, les versions sont déjà fixées dans `package.json`.)

### 2. Base de données

Dans Supabase : **SQL Editor** → coller `supabase/migrations/001_assistant_memory.sql` → **Run**. Le script active pgvector, crée les tables `assistant_memories` et `assistant_feedback`, les index HNSW et les fonctions `match_memories`, `match_lessons` et `purge_assistant_memories`. Il active aussi le RLS sans politique : la clé `anon` du navigateur n'a donc **aucun** accès à ces tables.

Optionnel : activer **pg_cron** et décommenter la planification en bas du script pour la purge automatique.

### 3. Variables d'environnement

```bash
cp .env.example .env   # puis renseigner les clés
```

`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (côté serveur **uniquement**), `ALLOWED_ORIGIN` (l'URL du front Soona), `ADMIN_TOKEN` (modération des leçons).

### 4. Lancer et tester

```bash
npm test          # 22 tests, sans réseau ni clé (doubles en mémoire)
npm run typecheck
npm run dev       # API sur http://localhost:8787
```

### 5. Brancher le front Soona

```js
import { createAssistantClient, renderReply } from "./soona-assistant.js";
const client = createAssistantClient({
  baseUrl: "https://api.soona.example.fr",
  getAccessToken: async () => (await supabase.auth.getSession()).data.session.access_token,
});
const out = await client.send("Quels documents apporter chez l'avocat ?");
renderReply(document.querySelector("#chat"), client, out);   // affiche la réponse + 👍 / 👎
```

Dans `soona/index.html`, autoriser l'API dans la CSP (`connect-src https://api.soona.example.fr`), puis lancer `node soona/tools/update-csp.mjs`.

## API

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/api/assistant/chat` | `{ message, conversationId? }` | `{ reply, messageId, conversationId, refused, memory }` |
| POST | `/api/assistant/feedback` | `{ messageId, rating: 1 \| -1, correction? }` | `201 { id, status }` · `404` pas à vous · `409` déjà noté |
| GET | `/api/assistant/memory` | — | export JSON (droit d'accès) |
| DELETE | `/api/assistant/memory` | — | effacement (droit à l'oubli) |
| PATCH | `/api/assistant/lessons/:id` | `{ status: approved \| rejected \| pending }` + en-tête `x-admin-token` | modération |

L'utilisateur est **toujours** identifié par son jeton Supabase vérifié côté serveur, jamais par un champ du corps de la requête.

## Comment l'assistant « apprend »

Le modèle n'est pas ré-entraîné : ce n'est ni nécessaire ni possible via l'API. L'apprentissage se fait à deux niveaux :

1. **À chaud, à chaque message.** On cherche les retours portant sur des questions proches et on les injecte dans le prompt comme leçons : une **correction** à appliquer, une réponse **👍** comme modèle à suivre, une réponse **👎** comme approche à éviter. L'effet est immédiat.
2. **À froid, en continu.** `npm run export-dataset` transforme les retours en jeu d'évaluation JSONL. On rejoue ces cas avant chaque changement de prompt, de modèle ou de réglage de mémoire, pour vérifier que la modification améliore les choses au lieu de se fier à l'intuition.

**Garde-fou anti-empoisonnement.** Un retour ne modifie le comportement que pour **son auteur** tant qu'un humain ne l'a pas validé (`PATCH /lessons/:id`). Sans ce garde-fou, n'importe quel utilisateur pourrait « corriger » l'assistant pour tout le monde.

## RGPD

| Exigence | Mise en œuvre |
|---|---|
| Minimisation | Anonymisation **avant** le LLM, les embeddings et la base. La table placeholder → valeur reste en mémoire le temps de la requête, puis elle est jetée. |
| Sécurité | RLS sans politique, clé service_role côté serveur, isolation par `user_id` dans chaque requête, logs sans contenu de message |
| Droit d'accès / portabilité | `GET /memory` |
| Droit à l'effacement | `DELETE /memory` |
| Limitation de conservation | `MEMORY_RETENTION_DAYS` (180 j par défaut), via pg_cron ou purge quotidienne du serveur. Les retours liés sont supprimés en cascade. |
| Transparence | Le champ `memory` de la réponse indique combien de souvenirs et de leçons ont été utilisés |

**Limites à connaître.**
- La détection des noms repose sur des **indices** (« je m'appelle… », civilités, signatures) et sur le **nom du profil**. Un prénom isolé (« dis à Julien… ») n'est détecté que si vous activez `PII_LLM_DETECTION=true` : Claude repère alors les noms, mais le texte brut est envoyé à l'API, ce qui doit figurer dans votre registre de traitements. Pour un niveau supérieur, branchez un outil de reconnaissance d'entités nommées (NER), par exemple Microsoft Presidio, via l'interface `NameDetector`.
- Conséquence de l'anonymisation : l'assistant ne retient pas le nom de l'utilisateur d'une session à l'autre. Dans la conversation en cours, il l'affiche correctement grâce à la réhydratation.
- Une AIPD (analyse d'impact) est recommandée avant la mise en production, et Anthropic et Voyage doivent figurer comme sous-traitants dans le registre.

## Ce qui a été vérifié

- **22 tests automatisés.** Aucune donnée personnelle n'atteint le LLM, les embeddings ni la base. La mémoire courte et la mémoire longue fonctionnent, sans fuite entre utilisateurs. La correction devient une leçon, appliquée à tous seulement après validation. Les tentatives d'injection via la mémoire sont neutralisées, les refus du modèle sont gérés, et l'export, l'effacement et la purge fonctionnent. Côté HTTP : 401, 400, 404, 409, 403, 429 et CORS.
- **Migration SQL exécutée** sur PostgreSQL avec pgvector 0.8.7 : recherche isolée par utilisateur, visibilité des leçons selon leur statut, contraintes, purge en cascade.
- **Non testé ici** : les appels réels à Claude, à Voyage et à Supabase, faute de clés dans cet environnement. Le code suit le SDK Anthropic 0.134 et le SDK Voyage 0.4, et le typecheck passe.
