/**
 * Next.js config.
 *
 * - `output: 'standalone'`: emits a self-contained `.next/standalone` folder so the
 *   production Docker image can be a tiny `node server.js` invocation. Without this,
 *   the runtime image needs the entire monorepo.
 * - `transpilePackages`: forces Next to compile our workspace TS packages (they
 *   ship as raw .ts; we don't pre-build them).
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@repo/billing',
    '@repo/crypto',
    '@repo/db',
    '@repo/embeddings',
    '@repo/flags',
    '@repo/jobs',
    '@repo/llm',
    '@repo/observability',
    '@repo/services',
    '@repo/shared',
    '@repo/ui',
  ],
  // Pino has dynamic imports that confuse Next's tree-shaker; mark as external.
  serverExternalPackages: ['pino', 'pino-pretty', '@prisma/client', 'pg-boss'],
};

export default nextConfig;
