# Architecture

This document captures the load-bearing design decisions for the RAG project.
The per-package READMEs explain *what* each package does; this document explains
*why* the system is shaped this way.

## The core framing

This is **not** a doc-chatbot with a different data source. It's a **longitudinal
knowledge-graph problem disguised as RAG**. The "documents" are conversations
stitched across time, between humans, about evolving code artifacts.

Three properties shape every decision below:

1. **Reconstructing narrative.** A PR + its reviews + the issue it closes + the
   commits + a later revert PR are *one story*. Embedding them as separate
   paragraphs returns shrapnel.
2. **Preserving temporal context.** "What fixed this?" is a question about
   *order*: incident → attempt → revert → real fix.
3. **Grounding to real GitHub URLs.** Citations must be deep links, not "doc 17, page 4."

If a proposed change degrades any of these three properties, push back.

## Topology — monolith with a worker sidecar

```
Browser ──▶ Next.js (App Router)  ◀── GitHub Webhooks
              │  - UI / tRPC / Auth / SSE
              ▼
         PostgreSQL
              │  - app schema
              │  - pgvector (HNSW)
              │  - pg-boss queue
              │  - tsvector FTS
              ▲
              │
         Worker (Node)
              │  - ingestion / chunking / embedding / webhooks
              ▼
   GitHub GraphQL    OpenAI (LLM + embeddings)
```

## Top-level decisions

### GitHub App (not OAuth App)

Per-installation rate limits (5000 req/hr per install), webhooks for free,
fine-grained permissions, installation tokens that survive user departures.
OAuth-only would be a re-platforming event in 6 months.

### Single Postgres for everything — app data + vectors + queue

One backup, one HA story, transactional enqueue. Add Redis only when you
outgrow it (you won't, for a long time).

### Worker is a separate process, same monorepo

Different concurrency model than the web app. Don't put long-running jobs
inside Next.js — serverless + multi-hour ingestion is pain.

### Single Dockerfile, two targets

Same source tree, same dependency graph. Build once in CI; deploy two
containers (web + worker) with different `CMD`. Simplest distribution.

## Subscription + feature flag (ship-dark pattern)

Subscription tracking runs from day one — every action accrues to a
`UsageMeter`. Enforcement (rate limits, paywalls) is gated by the
`billing.enforcement` feature flag. Flag flip → enforcement live within
5 minutes (the FlagService cache TTL). Zero code change, zero redeploy.

This means:
- We collect data from day one and can flip enforcement on without a panic.
- New limits can be tested against historical usage before turning the gate on.
- Per-installation overrides allow gradual rollout: enforce for 1 customer, watch,
  then 10%, then global.

## Provider abstraction (LLM + embedding)

Every concrete LLM provider implements `LLMProvider`. Services depend on the
interface, never on concrete classes. A factory constructs the right provider
for a given config. A resolver picks per request — user's BYO credential first,
system default fallback.

```
Service code                     Knows: LLMProvider interface only
        ↓
LLMProviderResolver              Picks: user credential OR system default
        ↓
LLMProviderFactory.create(cfg)   Returns: a concrete LLMProvider
        ↓
OpenAIProvider                   Wraps: openai SDK
AnthropicProvider                Wraps: @anthropic-ai/sdk      (Phase 2)
GoogleProvider                   Wraps: @google/genai          (Phase 2)
AzureOpenAIProvider              Wraps: openai SDK + azure URL (Phase 2)
OpenAICompatibleProvider         Wraps: openai SDK + custom base URL — covers Groq, Together, Ollama
```

Adding a provider = one new file in `providers/` + one `case` in the factory.
Zero changes to call sites.

### BYO-LLM design

- User's API key is stored encrypted (AES-256-GCM) in `ProviderCredential`.
- Validate-before-store: the new key is verified by `provider.validate()` *before*
  it touches the DB. Invalid keys never persist.
- The resolver decrypts on every request — keys live in memory only for the call's
  duration. No long-lived plaintext.

### Why BYO-embedding is NOT exposed in MVP

Switching embedding providers invalidates every existing vector — different
models live in different mathematical spaces. Until we have a re-index migration
job (Phase 2), the resolver always returns the system default for embeddings.
The `ProviderCredential.kind=EMBEDDING` row is reserved on the schema so the
feature can be turned on later without a migration.

## Service layer + DI

- All business logic lives in service classes (`packages/services`).
- tRPC routers are thin: parse Zod, call a service, return result.
- Services are constructor-injected — no static methods, no module globals
  for state.
- Manual DI container in `apps/web/src/server/container.ts` wires real
  implementations. Tests build a container with stubs.

This layout means: routers stay testable, services are mockable, infrastructure
swaps don't ripple through the codebase.

## Data model

### Faithful to GitHub's object graph

`PullRequest`, `Issue`, `ReviewComment`, `IssueComment`, `Commit`, plus an
explicit `Reference` table for cross-links (PR closes Issue, PR reverts PR).
Do NOT collapse into a generic `documents` table — retrieval and analytics
queries need the structure.

### Chunk + ChunkEmbedding (separated)

- `Chunk` is the unit of meaning extracted from artifacts (PR header, review
  thread, issue discussion topic). Carries denormalized metadata for filtering
  at retrieval time without joins.
- `ChunkEmbedding` is in a separate table — vectors are 4KB each, separating
  them keeps the hot table small and lets multiple embedding model versions
  coexist during a migration.

### `narrativeKey` — the secret weapon

All chunks belonging to one PR's story share `narrativeKey = pr:repo123:1847`.
At retrieval time, results are collapsed by this key so users see "PR #1847
with 3 relevant snippets," not 3 disconnected fragments.

### `contentHash`

SHA-256 of the chunk text. Re-ingestion is idempotent — a comment edit that
doesn't change the chunk text doesn't trigger re-embedding. Real money saved.

### Vector index — HNSW

`USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`.
Faster queries than IVFFlat, no training data required. Build AFTER initial
backfill — building during ingest dramatically slows inserts. See `extras.sql`.

## Five-phase ingestion pipeline (Phase 2 — scaffolded today)

```
discover → hydrate → normalize → chunk → embed
   pg-boss   pg-boss    in-tx     pg-boss  pg-boss
```

Each phase is a distinct job kind. Retries, backoff, DLQ work per phase.
Backfill is resumable via `IngestionJob.cursor`.

Webhook = signal, not state. Always re-fetch authoritative state from GraphQL
before writing. GitHub does NOT guarantee webhook order.

Per-installation serialization for ingestion jobs uses a Postgres advisory
lock — only one ingest job per install runs at a time, regardless of worker
replica count. Respects GitHub's per-install rate limit.

## Nine-step retrieval (Phase 2 — scaffolded today)

1. Query understanding — entity extraction + HyDE.
2. Filter construction — SQL filters from extracted entities.
3. Parallel candidate retrieval — pgvector cosine + tsvector FTS + exact regex.
4. Reciprocal Rank Fusion — `score = Σ 1/(60 + rank)`.
5. Temporal scoring — recency boost (180d half-life), floor at 0.5.
6. Narrative grouping — collapse by `narrativeKey`.
7. Rerank stub — Cohere/Voyage rerank slot for Phase 2.
8. Context assembly — explicit `[1]`, `[2]` citation IDs.
9. Generation — strict citation prompt; refuse on weak retrieval.

## Conventions

- **No business logic in tRPC routers.**
- **No direct Octokit / OpenAI calls outside their abstraction packages.**
- **Plaintext secrets exist only in memory.**
- **Exhaustive switches via `default: const _: never`.**
- **`@repo/chunking` is pure** — no DB, no network, no env.
- **Default no comments**, except: public API JSDoc, non-obvious WHY, file
  headers explaining the module's role.

## Forward path

- M1: GitHub App auth flow + repo selection UI.
- M2: Discover + hydrate jobs for PRs (real ingestion).
- M3: Issues + commits + references.
- M4: Chunkers + embed pipeline.
- M5: Retrieval + grounded generation + citations.
- M6: Webhooks + incremental sync.
- M7: Polish + admin UI for jobs/flags.

See `memory/arch_roadmap.md` for the post-MVP roadmap (reranking, Slack
ingestion, code indexing, agent surface).
