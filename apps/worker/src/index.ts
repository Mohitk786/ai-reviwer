import { getEnv } from '@repo/shared';
import { getLogger } from '@repo/observability';
import {
  startBoss,
  stopBoss,
  getBoss,
  registerHandlers,
  defineHandler,
  JobNames,
} from '@repo/jobs';
import { disconnectPrisma, getPrismaClient } from '@repo/db';
import { GitHubAppClient } from '@repo/github';
import { LLMProviderFactory } from '@repo/llm';
import { EmbeddingProviderFactory } from '@repo/embeddings';
import {
  createProcessWebhookHandler,
  createIndexRepositoryHandler,
  createIndexFileHandler,
  createProcessDevCommentHandler,
} from '@repo/ingestion';
import { createReviewPrHandler, createStoreReviewMemoryHandler } from '@repo/review';

const log = getLogger('worker');

async function main(): Promise<void> {
  const env = getEnv();
  log.info({ nodeEnv: env.NODE_ENV }, 'worker booting');

  const prisma = getPrismaClient();
  const github = new GitHubAppClient({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    logger: log.child({ component: 'github-app-client' }),
  });
  const llm = LLMProviderFactory.create(
    env.ANTHROPIC_API_KEY
      ? { kind: 'anthropic', apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_REVIEW_MODEL }
      : env.GROQ_API_KEY
        ? { kind: 'openai_compatible', apiKey: env.GROQ_API_KEY, baseUrl: env.GROQ_BASE_URL, model: env.GROQ_REVIEW_MODEL }
        : { kind: 'openai', apiKey: env.OPENAI_API_KEY, model: env.OPENAI_DEFAULT_CHAT_MODEL },
  );
  const embedding = EmbeddingProviderFactory.create(
    env.VOYAGE_API_KEY
      ? { kind: 'voyage', apiKey: env.VOYAGE_API_KEY, model: env.VOYAGE_EMBEDDING_MODEL }
      : { kind: 'openai', apiKey: env.OPENAI_API_KEY, model: env.OPENAI_DEFAULT_EMBEDDING_MODEL, dimensions: env.OPENAI_EMBEDDING_DIMENSIONS },
  );

  await startBoss({ connectionString: env.DATABASE_URL, logger: log });
  log.info('pg-boss started');
  const boss = getBoss();

  const processWebhook = createProcessWebhookHandler({ prisma, boss, logger: log });
  const indexRepository = createIndexRepositoryHandler({ prisma, github, embedding, logger: log });
  const indexFile = createIndexFileHandler({ prisma, github, embedding, logger: log });
  const reviewPr = createReviewPrHandler({ prisma, github, logger: log, llm, embedding, boss });
  const storeReviewMemory = createStoreReviewMemoryHandler({ prisma, embedding, logger: log });
  const processDevComment = createProcessDevCommentHandler({ prisma, github, llm, embedding, logger: log });

  await registerHandlers([
    defineHandler(JobNames.Hello, { batchSize: 8 }, async ({ id, data }) => {
      log.info({ jobId: id, message: data.message, correlationId: data.correlationId }, 'hello');
    }),

    defineHandler(JobNames.WebhookProcess, { batchSize: 8 }, async ({ data }) => {
      await processWebhook({ deliveryId: data.deliveryId });
    }),

    defineHandler(JobNames.IndexRepository, { batchSize: 2 }, async (job) => {
      await indexRepository(job);
    }),

    defineHandler(JobNames.IndexFile, { batchSize: 8 }, async (job) => {
      await indexFile(job);
    }),

    defineHandler(JobNames.ReviewPr, { batchSize: 4 }, async (job) => {
      await reviewPr(job);
    }),

    defineHandler(JobNames.StoreReviewMemory, { batchSize: 8 }, async (job) => {
      await storeReviewMemory(job);
    }),

    defineHandler(JobNames.ProcessDeveloperComment, { batchSize: 8 }, async (job) => {
      await processDevComment(job);
    }),
  ]);
  log.info('handlers registered');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutdown initiated');
    try {
      await stopBoss();
      await disconnectPrisma();
      log.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'worker failed to boot');
  process.exit(1);
});
