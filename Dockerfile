# =============================================================================
# Multi-stage Dockerfile — builds two runtime images (web, worker) from one source.
#
# Why two targets, one Dockerfile:
#   - Same source tree, same dependency graph, same Prisma client.
#   - Different CMDs (Next.js standalone server vs node worker).
#   - Build once in CI; deploy two containers from the same image, or use
#     the explicit per-target tags for finer control.
#
# Build commands:
#   docker build --target web    -t rag-web:latest    .
#   docker build --target worker -t rag-worker:latest .
#
# Or via docker-compose: `docker compose up --build` from repo root.
# =============================================================================

# ---- stage 1: deps ---------------------------------------------------------
# Install deps once. Using `npm ci --include=dev` so subsequent `next build` /
# `tsc` work — devDependencies are stripped in the runtime stages.
FROM node:20-alpine AS deps
WORKDIR /app
# Copy lockfiles first for better layer caching — `npm ci` re-runs only when
# package.json or package-lock.json change.
COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/billing/package.json ./packages/billing/package.json
COPY packages/chunking/package.json ./packages/chunking/package.json
COPY packages/crypto/package.json ./packages/crypto/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/embeddings/package.json ./packages/embeddings/package.json
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY packages/flags/package.json ./packages/flags/package.json
COPY packages/github/package.json ./packages/github/package.json
COPY packages/ingestion/package.json ./packages/ingestion/package.json
COPY packages/jobs/package.json ./packages/jobs/package.json
COPY packages/llm/package.json ./packages/llm/package.json
COPY packages/observability/package.json ./packages/observability/package.json
COPY packages/retrieval/package.json ./packages/retrieval/package.json
COPY packages/services/package.json ./packages/services/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN npm ci

# ---- stage 2: builder ------------------------------------------------------
# Compile TypeScript, run prisma generate, build Next.js standalone bundle.
FROM deps AS builder
WORKDIR /app
COPY . .
# Generate Prisma client BEFORE next build (web imports types from it).
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma
# Turborepo builds web (which transpiles workspace packages it depends on) and
# worker (compiles to dist/).
RUN npx turbo run build --filter=web --filter=worker

# ---- stage 3a: web runtime --------------------------------------------------
# Next.js standalone output is fully self-contained — node_modules subset, .next
# bundle, and a tiny server.js. Image size ~250MB.
FROM node:20-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Run as non-root.
RUN addgroup -S app && adduser -S app -G app

# Standalone bundle includes server + minimum node_modules.
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /app/apps/web/public ./apps/web/public

# Prisma schema + migrations + extras.sql so the entrypoint can run them.
COPY --from=builder --chown=app:app /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder --chown=app:app /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=app:app /app/node_modules/prisma ./node_modules/prisma

COPY --chown=app:app docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER app
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/web/server.js"]

# ---- stage 3b: worker runtime ----------------------------------------------
# The worker is a long-running Node process. We need the full dependency tree
# (no Next standalone optimization) since pg-boss + Prisma run at runtime.
FROM node:20-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app

# Production-only node_modules (re-install for slimmer image).
COPY package.json package-lock.json turbo.json ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages ./packages
RUN npm ci --omit=dev --workspaces --include-workspace-root

# Prisma client + schema.
COPY --from=builder --chown=app:app /app/packages/db/src/generated ./packages/db/src/generated
COPY --from=builder --chown=app:app /app/packages/db/prisma ./packages/db/prisma

# Compiled worker bundle.
COPY --from=builder --chown=app:app /app/apps/worker/dist ./apps/worker/dist

COPY --chown=app:app docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER app
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/worker/dist/index.js"]
