-- ============================================================================
-- Mémoire vectorielle + boucle de feedback de l'assistant Soona (Supabase / pgvector)
-- Exécuter dans l'éditeur SQL Supabase, ou : supabase db push
-- Tout le contenu texte stocké ici est DÉJÀ anonymisé par le serveur (src/pii.ts).
-- ============================================================================

create extension if not exists vector;

-- 1. Mémoire : un enregistrement par tour de conversation ------------------------
create table if not exists public.assistant_memories (
  id               uuid primary key,
  user_id          uuid not null,            -- id Supabase Auth (pseudonyme), jamais l'email
  conversation_id  uuid not null,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null check (char_length(content) <= 8000),
  embedding        vector(1024) not null,    -- = EMBEDDING_DIM (voyage-3.5 : 1024)
  created_at       timestamptz not null default now()
);

-- Index ANN (HNSW, distance cosinus) pour le rappel sémantique
create index if not exists assistant_memories_embedding_idx
  on public.assistant_memories using hnsw (embedding vector_cosine_ops);
-- Index pour la mémoire courte (derniers tours d'une conversation) et l'effacement par utilisateur
create index if not exists assistant_memories_conv_idx
  on public.assistant_memories (user_id, conversation_id, created_at desc);

-- 2. Feedback : pouce + correction, avec le contexte (question/réponse) ------------
create table if not exists public.assistant_feedback (
  id                  uuid primary key,
  user_id             uuid not null,
  conversation_id     uuid not null,
  message_id          uuid not null references public.assistant_memories(id) on delete cascade,
  rating              smallint not null check (rating in (-1, 1)),
  correction          text check (char_length(correction) <= 2000),
  question            text not null,
  answer              text not null,
  question_embedding  vector(1024) not null,
  -- 'pending' : leçon appliquée uniquement à son auteur
  -- 'approved' : validée par un humain, appliquée à tous les utilisateurs
  -- 'rejected' : ignorée (abus, erreur, tentative d'empoisonnement)
  status              text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at          timestamptz not null default now(),
  unique (user_id, message_id)               -- un seul vote par réponse et par utilisateur
);

create index if not exists assistant_feedback_embedding_idx
  on public.assistant_feedback using hnsw (question_embedding vector_cosine_ops);
create index if not exists assistant_feedback_user_idx on public.assistant_feedback (user_id, created_at desc);

-- 3. Sécurité : RLS activé SANS politique → inaccessible avec la clé « anon » du navigateur.
--    Seul le serveur (clé service_role) lit et écrit. Le front passe toujours par l'API.
alter table public.assistant_memories enable row level security;
alter table public.assistant_feedback enable row level security;

-- 4. Recherche sémantique dans la mémoire d'UN utilisateur ------------------------
-- hnsw.iterative_scan (pgvector ≥ 0.8) : continue le parcours de l'index quand le filtre
-- user_id élimine beaucoup de candidats, sinon on obtiendrait trop peu de résultats.
create or replace function public.match_memories(
  p_user_id uuid,
  p_query vector(1024),
  p_k int,
  p_min_similarity float,
  p_exclude_conversation uuid default null
)
returns table (id uuid, user_id uuid, conversation_id uuid, role text, content text, created_at timestamptz, similarity float)
language sql stable
set hnsw.iterative_scan = 'relaxed_order'
as $$
  select m.id, m.user_id, m.conversation_id, m.role, m.content, m.created_at,
         1 - (m.embedding <=> p_query) as similarity
  from public.assistant_memories m
  where m.user_id = p_user_id
    and (p_exclude_conversation is null or m.conversation_id <> p_exclude_conversation)
    and 1 - (m.embedding <=> p_query) >= p_min_similarity
  order by m.embedding <=> p_query
  limit p_k;
$$;

-- 5. Leçons tirées du feedback : celles de l'utilisateur + les leçons validées pour tous
create or replace function public.match_lessons(
  p_user_id uuid,
  p_query vector(1024),
  p_k int,
  p_min_similarity float
)
returns table (id uuid, user_id uuid, conversation_id uuid, message_id uuid, rating smallint, correction text,
               question text, answer text, status text, created_at timestamptz, similarity float)
language sql stable
set hnsw.iterative_scan = 'relaxed_order'
as $$
  select f.id, f.user_id, f.conversation_id, f.message_id, f.rating, f.correction,
         f.question, f.answer, f.status, f.created_at,
         1 - (f.question_embedding <=> p_query) as similarity
  from public.assistant_feedback f
  where f.status <> 'rejected'
    and (f.user_id = p_user_id or f.status = 'approved')
    and 1 - (f.question_embedding <=> p_query) >= p_min_similarity
  order by f.question_embedding <=> p_query
  limit p_k;
$$;

-- 6. Durée de conservation (RGPD, principe de limitation) --------------------------
create or replace function public.purge_assistant_memories(p_before timestamptz)
returns int language plpgsql as $$
declare n int;
begin
  delete from public.assistant_memories where created_at < p_before;
  get diagnostics n = row_count;
  return n;
end $$;

-- Planification quotidienne avec pg_cron (à activer dans Supabase > Database > Extensions) :
-- select cron.schedule('purge-assistant-memories', '17 3 * * *',
--   $$ select public.purge_assistant_memories(now() - interval '180 days') $$);
