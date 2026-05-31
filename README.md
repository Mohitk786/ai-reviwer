# Engineering Workflow — AI Code Reviewer

An AI-powered GitHub App that automatically reviews pull requests. When a developer opens or updates a PR, the app fetches the diff, sends each changed file to an LLM, and posts structured inline comments + a summary directly on the GitHub PR — in COMMENT mode only (never blocks merges).

---

## What happens when a PR is opened

This is the full journey, step by step:

```
Developer opens PR on GitHub
        │
        ▼
GitHub sends a webhook POST to /api/webhooks/github
        │
        ▼
Web server verifies HMAC signature, stores the delivery,
enqueues a background job (webhook.process)
        │
        ▼
Worker picks up webhook.process job
Routes it → pull_request event → creates AiReview record
Enqueues review.pr job
        │
        ▼
Worker picks up review.pr job
Fetches PR files + metadata from GitHub API
Filters files (ignore paths, max files cap)
For each file → calls LLM → validates comment lines
        │
        ▼
Aggregates all comments + calls LLM for PR summary
Posts COMMENT review to GitHub (inline comments + body)
        │
        ▼
Marks AiReview as COMPLETED in DB
Developer sees comments on their PR
```

---

## Repo layout

```
apps/
  web/          Next.js app — HTTP routes, auth, webhook intake, UI
  worker/       Node.js process — background job execution

packages/
  db/           Prisma schema + migrations + DB client singleton
  shared/       Env validation, error classes, shared types
  crypto/       AES-256-GCM encryption for stored secrets
  observability/ Logger (Pino) + request context (AsyncLocalStorage)
  github/       GitHub App client — OAuth, webhooks, review API
  jobs/         pg-boss queue — job definitions, handler registration
  llm/          LLM provider abstraction — OpenAI + Anthropic + factory
  embeddings/   Embedding provider abstraction (for future RAG features)
  diff-parser/  Parses GitHub unified diff → commentable line numbers
  ingestion/    Webhook event router (pull_request → AiReview + job)
  review/       AI review orchestrator — LLM calls, comment validation, GitHub post
  services/     Business logic — Auth, Repository, Subscription, Entitlement
  flags/        Feature flags with 5-min in-process cache
  billing/      Plan + entitlement primitives
  ui/           Shared React components (shadcn/tailwind)
  retrieval/    (future) Hybrid search for RAG queries
  chunking/     (future) Code chunking for embeddings
  typescript-config/  Shared tsconfig
  eslint-config/      Shared eslint rules
```

---

## Architecture — the big picture

### Two processes, one database

The system runs as **two separate processes** that share one PostgreSQL database:

- **`apps/web`** — Next.js server. Handles HTTP: serves the UI, handles GitHub OAuth, receives webhooks. It never does heavy work inline — it just stores data and enqueues jobs.
- **`apps/worker`** — Plain Node.js. Runs forever in the background. Picks up jobs from the queue and does the actual work (LLM calls, GitHub API calls).

**Why split them?** Webhooks must respond to GitHub within a few seconds. LLM calls take 5–30 seconds. If the web server did both, webhooks would time out. The worker handles the slow work without any time pressure.

### pg-boss — the job queue

Jobs (tasks) are stored in a `pgboss` schema inside the same PostgreSQL database. No Redis, no separate queue service. The web server writes a job row; the worker polls and picks it up.

**Why pg-boss instead of Redis/SQS?** Fewer moving parts. One database to back up, one connection to manage. For this scale, Postgres is more than fast enough.

**Important (pg-boss v10 gotcha):** Queues must be explicitly created with `createQueue()` before you can `send()` to them. Both the web server (on container boot) and the worker (when registering handlers) call `createQueue` for every queue they use.

### Manual dependency injection

There is no DI framework. `apps/web/src/server/container.ts` manually wires together every dependency (Prisma, pg-boss, GitHub client, services) and returns a typed `Container` object. Route handlers call `getContainer()` to get what they need.

**Why manual?** At this scale, an explicit function is more readable than decorators/reflection. TypeScript inference works end-to-end with no magic.

### Separation of concerns — the strict rule

```
Route handler  →  Service  →  Repository (Prisma)
                     ↓
               External APIs (GitHub, LLM)
```

- **Route handlers** — parse input, call a service, return result. Zero business logic.
- **Services** — own all business logic. No HTTP concepts (no `req`/`res`).
- **`@repo/github`, `@repo/llm`** — all GitHub and LLM calls go through these packages. No raw `fetch()` or SDK calls in business logic.

---

## Package-by-package walkthrough

### `packages/db`
The single source of truth for the database schema.

Key models:
- `Installation` — a GitHub App installation (org or user)
- `Repository` — a repo the app has access to (`enabled = false` by default, must be explicitly turned on)
- `AiReview` — one review per (repo, PR number, commit SHA). Status: `PENDING → RUNNING → COMPLETED / FAILED / SKIPPED`
- `AiReviewComment` — individual inline comments with line number, severity, body
- `ReviewConfiguration` — per-repo or per-installation settings (ignore paths, max files, etc.)
- `WebhookDelivery` — every GitHub webhook stored here for deduplication. `processedAt` is set after the worker processes it — redeliveries are no-ops.

The Prisma client is a singleton (`getPrismaClient()`). Never call `new PrismaClient()` anywhere else.

---

### `packages/shared`
Two things:
1. **`getEnv()`** — Zod schema that validates all env vars at startup. If anything is missing or wrong, the process crashes with a clear error message naming the bad field.
2. **`mapErrorToResponse()`** — converts internal errors to safe HTTP responses (no stack traces leaking to clients).

---

### `packages/crypto`
`EncryptionService` wraps AES-256-GCM. Used to encrypt user-supplied API keys before storing them in the database. The master key lives in `ENCRYPTION_KEY` env var only — never in the DB.

---

### `packages/observability`
- **Logger** — Pino-based structured logger. Every log line is JSON with a consistent shape.
- **Request context** — uses `AsyncLocalStorage` to carry `requestId`, `userId`, `installationId` through an entire request without threading them through every function call. The `withRouteContext` middleware in `apps/web` opens this context for every route.

---

### `packages/github`
Three responsibilities:
1. **`GitHubAppClient`** — authenticates as the GitHub App and generates per-installation Octokit clients.
2. **`verifyGithubSignature()`** — HMAC-SHA256 verification for incoming webhooks. Uses `timingSafeEqual` to prevent timing attacks.
3. **`listPRFiles()`, `getPRMetadata()`, `createPRReview()`** — the review-specific GitHub API calls. Uses the `line + side` comment API (not the deprecated `position` integer).

---

### `packages/jobs`
- **`JobNames`** — the enum of all job names (`webhook.process`, `review.pr`, `review.pr.file`, etc.)
- **`jobSchemas`** — Zod schema for every job's payload. Validated at runtime before the handler runs.
- **`registerHandlers()`** — wraps `boss.work()`. Creates the queue, validates payload, calls the handler.
- **`ensureQueues()`** — creates queues without throwing if they already exist. Called by the web server at boot.

---

### `packages/diff-parser`
Takes GitHub's unified diff string (the `patch` field on a PR file) and returns:
- `commentableLines: Set<number>` — the actual file line numbers where you CAN post a comment (added lines `+` and context lines ` ` on the new side — not removed lines `-`)
- `isCommentableLine(parsed, line)` — check before posting a comment

**Why this exists:** The LLM sometimes hallucinates line numbers. Every LLM comment is checked against `commentableLines` before being posted. A comment on a non-existent line would cause GitHub's review API to reject the entire review.

---

### `packages/ingestion`
The webhook event router. `createProcessWebhookHandler` handles:
- `pull_request` (opened/synchronize/reopened, non-draft) → creates `AiReview` + enqueues `review.pr`
- `installation` (suspend/unsuspend) → flips `Installation.suspended`
- `installation_repositories` (added/removed) → upserts or disables `Repository` rows

Everything else is logged and discarded.

---

### `packages/review`
The core AI logic. Three layers:

**`prompts.ts`** — the actual text sent to the LLM. File review prompt instructs the model to only reference lines in the diff, output JSON, max 10 comments per file. PR summary prompt asks for 2-4 sentences covering what changed and what was found.

**`llm-client.ts`** — wraps `LLMProvider.chat()`. Strips markdown fences from the response (models sometimes wrap JSON in ```). Validates output with Zod. Falls back to an empty review if the LLM returns garbage — one bad file never kills the whole review.

**`orchestrator.ts`** — the `review.pr` handler. Full flow:
1. Load `AiReview` (must be PENDING), mark RUNNING
2. Load `ReviewConfiguration` — check if enabled, get ignore rules
3. Fetch PR metadata + file list from GitHub
4. Filter: skip removed files, binary files (no patch), ignored paths, cap at `maxFilesPerPr`
5. For each file: parse diff, call LLM, drop comments on invalid lines
6. Save `AiReviewComment` rows
7. Call LLM for PR summary
8. Post GitHub review (`COMMENT` event — never blocks merges)
9. Mark `AiReview` COMPLETED with `githubReviewId`, `totalComments`, `summary`
10. On any error: mark FAILED with error message

---

### `packages/llm`
`LLMProvider` interface with a factory pattern:
```
LLMProviderFactory.create({ kind: 'openai', apiKey, model })
                          { kind: 'anthropic', apiKey, model }
```
Adding a new provider = one new file in `providers/` + one case in `factory.ts`. No call sites change.

Currently active for reviews: **OpenAI** (`OPENAI_API_KEY`, `OPENAI_DEFAULT_CHAT_MODEL`). Anthropic provider is wired and ready — change `kind: 'openai'` to `kind: 'anthropic'` in `packages/review/src/orchestrator.ts` to switch.

---

### `packages/services`
Business logic classes, all constructor-injected:
- **`AuthService`** — GitHub OAuth flow, session creation, installation linking
- **`RepositoryService`** — list/enable/disable repos for an installation
- **`SubscriptionService`** — plan lookup
- **`EntitlementService`** — checks if an action is allowed under the current plan

---

## Key design decisions

| Decision | Why |
|---|---|
| One Postgres for everything (app + queue + pgvector) | Fewer services to operate. One backup story. Transactional job enqueue. |
| pg-boss over Redis/BullMQ | No Redis dependency. At this scale, Postgres queue is sufficient. |
| Webhook stores first, processes async | GitHub expects < 5s response. LLM calls take 10–30s. Must decouple. |
| COMMENT mode only, never REQUEST_CHANGES | REQUEST_CHANGES blocks merges. Reviews should be advisory, not gatekeeping. |
| Line validation before posting | GitHub rejects entire reviews with invalid line numbers. Validate every comment. |
| LLM output via Zod | LLMs hallucinate structure. Validate before using. Fallback on failure. |
| `enabled = false` by default for repos | Opt-in model. The app never reviews a repo the user hasn't explicitly turned on. |
| HMAC-SHA256 with `timingSafeEqual` | Timing-safe comparison prevents signature oracle attacks. |
| AsyncLocalStorage for request context | Avoids threading `requestId`/`userId` through every function call. |

---

## Local development

### Prerequisites
- Node 20+
- Docker (for Postgres)
- A GitHub App ([create one here](https://github.com/settings/apps/new))
- ngrok (to expose local webhook endpoint to GitHub)
- An OpenAI API key

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres
docker compose -f docker-compose.dev.yml up -d

# 3. Run DB migrations
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

# 4. Fill in .env.local (copy from .env.example, add real values)
cp .env.example .env.local
```

Required env vars:
```bash
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
OPENAI_API_KEY=
ENCRYPTION_KEY=    # 64 hex chars: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=    # same generator
```

### Running locally

```bash
# Terminal 1 — web server (Next.js, port 3000)
npm run dev -w web

# Terminal 2 — background worker
npm run dev -w worker

# Terminal 3 — expose webhook endpoint
ngrok http 3000
```

Set the ngrok URL as webhook URL in your GitHub App settings:
```
https://<your-ngrok-id>.ngrok.io/api/webhooks/github
```

### GitHub App permissions required
- **Repository permissions:** Pull requests → Read & write
- **Subscribe to events:** Pull requests, Installation, Installation repositories

### Enable a repo for review

1. Sign in at `http://localhost:3000` with GitHub OAuth
2. Open Prisma Studio: `npx prisma studio --schema packages/db/prisma/schema.prisma`
3. Find your repo in the **Repository** table → set `enabled = true`

### Trigger a review

Open or push to a PR on the enabled repo. Watch the worker terminal — you'll see the review being processed and posted within ~30 seconds.

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ENCRYPTION_KEY` | Yes | 64 hex chars (32 bytes) — master encryption key |
| `SESSION_SECRET` | Yes | 64 hex chars — JWT session signing key |
| `GITHUB_APP_ID` | Yes | Numeric app ID from GitHub App settings |
| `GITHUB_APP_SLUG` | Yes | URL slug of your GitHub App |
| `GITHUB_APP_CLIENT_ID` | Yes | OAuth client ID |
| `GITHUB_APP_CLIENT_SECRET` | Yes | OAuth client secret |
| `GITHUB_APP_PRIVATE_KEY` | Yes | PEM private key for GitHub App authentication |
| `GITHUB_WEBHOOK_SECRET` | Yes | Secret for HMAC webhook verification |
| `OPENAI_API_KEY` | Yes | Used for LLM review calls |
| `OPENAI_DEFAULT_CHAT_MODEL` | No | Default: `gpt-4.1-mini` |
| `ANTHROPIC_API_KEY` | No | Set this + change `kind` in orchestrator.ts to use Claude |

---

## Production deployment

Deploy `apps/web` and `apps/worker` as two separate services from the same Docker image. Both read from the same `DATABASE_URL`.

```bash
# Build
docker compose build

# Run full stack locally (web + worker + Postgres)
docker compose up
```

For cloud deployment: Fly.io, Railway, Render, or AWS ECS all work. Run the web target with autoscaling tied to RPS; run the worker with `min-instances=1` so it's always polling.

---

## Conventions

- **No business logic in route handlers.** Parse input → call service → return result.
- **No raw SDK calls outside abstraction packages.** Use `@repo/github`, `@repo/llm` — never raw `fetch` or Octokit in services.
- **All secrets encrypted at rest.** Use `@repo/crypto` before any DB write.
- **Validate LLM output with Zod.** Never trust structure from the model.
- **Every webhook is idempotent.** GitHub re-delivers on timeout. The `WebhookDelivery.processedAt` check makes re-deliveries no-ops.
- **`npm install`** for all package management. Never pnpm.
