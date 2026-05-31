/**
 * DI container — manual dependency wiring for the web app's request graph.
 */

import { getPrismaClient } from '@repo/db';
import { getLogger } from '@repo/observability';
import { EncryptionService } from '@repo/crypto';
import { FeatureFlagService } from '@repo/flags';
import { LLMProviderResolver } from '@repo/llm';
import { GitHubAppClient } from '@repo/github';
import { startBoss, ensureQueues, JobNames, type Boss } from '@repo/jobs';
import {
  AuthService,
  ProviderCredentialService,
  SubscriptionService,
  RepositoryService,
} from '@repo/services';
import { getEnv } from '@repo/shared';

export interface Container {
  // Infra
  prisma: ReturnType<typeof getPrismaClient>;
  logger: ReturnType<typeof getLogger>;
  encryption: EncryptionService;
  github: GitHubAppClient;
  boss: Boss;

  // Resolvers
  flags: FeatureFlagService;
  llm: LLMProviderResolver;

  // Services
  auth: AuthService;
  credentials: ProviderCredentialService;
  repositories: RepositoryService;
}

let containerPromise: Promise<Container> | null = null;

export function getContainer(): Promise<Container> {
  if (containerPromise) return containerPromise;
  containerPromise = buildContainer();
  return containerPromise;
}

async function buildContainer(): Promise<Container> {
  const env = getEnv();

  const prisma = getPrismaClient();
  const logger = getLogger('web');
  const encryption = new EncryptionService(env.ENCRYPTION_KEY);
  encryption.selfTest();

  const github = new GitHubAppClient({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    logger: logger.child({ component: 'github-app-client' }),
  });

  const boss = await startBoss({
    connectionString: env.DATABASE_URL,
    logger: logger.child({ component: 'pg-boss' }),
  });
  await ensureQueues([
    JobNames.WebhookProcess,
    JobNames.IndexRepository,
    JobNames.IndexFile,
  ]);

  const flags = new FeatureFlagService(prisma);
  const credentials = new ProviderCredentialService(prisma, encryption);

  const llm = new LLMProviderResolver(credentials, {
    kind: 'openai',
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_DEFAULT_CHAT_MODEL,
  });

  // SubscriptionService is only used internally by AuthService (free plan setup on sign-in).
  const subscriptions = new SubscriptionService(prisma);
  const auth = new AuthService(prisma, subscriptions, {
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
  });
  const repositories = new RepositoryService(prisma, github, boss);

  return {
    prisma,
    logger,
    encryption,
    github,
    boss,
    flags,
    llm,
    auth,
    credentials,
    repositories,
  };
}
