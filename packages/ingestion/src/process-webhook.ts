
import { z } from 'zod';
import type { PrismaClient } from '@repo/db';
import type { Logger } from '@repo/observability';
import type Boss from 'pg-boss';
import { JobNames } from '@repo/jobs';

export interface ProcessWebhookDeps {
  prisma: PrismaClient;
  boss: Boss;
  logger: Logger;
}

export interface ProcessWebhookInput {
  deliveryId: string;
}

export function createProcessWebhookHandler(deps: ProcessWebhookDeps) {
  return async function handleWebhookDelivery(input: ProcessWebhookInput): Promise<void> {
    const { prisma, boss, logger } = deps;

    const delivery = await prisma.webhookDelivery.findUniqueOrThrow({
      where: { deliveryId: input.deliveryId },
    });

    const log = logger.child({
      deliveryId: input.deliveryId,
      event: delivery.event,
      action: delivery.action,
    });

    switch (delivery.event) {
      case 'pull_request':
        await handlePullRequestEvent(delivery.payload, { prisma, boss, log });
        break;
      case 'push':
        await handlePushEvent(delivery.payload, { prisma, boss, log });
        break;
      case 'installation':
        await handleInstallationEvent(delivery.payload, { prisma, log });
        break;
      case 'installation_repositories':
        await handleInstallationRepositoriesEvent(delivery.payload, { prisma, log });
        break;
      default:
        log.debug('webhook event not handled — skipping');
    }

    await prisma.webhookDelivery.update({
      where: { deliveryId: input.deliveryId },
      data: { processedAt: new Date() },
    });

    log.info('webhook delivery processed');
  };
}

// ---------------------------------------------------------------------------
// pull_request
// ---------------------------------------------------------------------------

const REVIEW_TRIGGERING_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);

const prPayloadSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({ sha: z.string().min(7) }),
    title: z.string().default(''),
    body: z.string().nullable().optional(),
    state: z.string(),
    merged: z.boolean().optional(),
    draft: z.boolean().optional(),
    user: z.object({ login: z.string() }).nullable().optional(),
  }),
  repository: z.object({
    id: z.number().int(),
    name: z.string(),
    owner: z.object({ login: z.string() }),
  }),
  installation: z.object({ id: z.number().int() }).optional(),
}).passthrough();

async function handlePullRequestEvent(
  payload: unknown,
  ctx: { prisma: PrismaClient; boss: Boss; log: Logger },
): Promise<void> {
  const { prisma, boss, log } = ctx;

  const parsed = prPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues }, 'pull_request payload malformed — skipping');
    return;
  }

  const { action, pull_request: pr, repository } = parsed.data;

  if (!REVIEW_TRIGGERING_ACTIONS.has(action)) {
    log.debug({ action }, 'pull_request action does not trigger review');
    return;
  }

  // Draft PRs: skip — review them when they're marked ready for review.
  if (pr.draft) {
    log.debug({ prNumber: pr.number }, 'pull_request is a draft — skipping');
    return;
  }

  // Find the repo in our DB by GitHub repo ID.
  const repo = await prisma.repository.findFirst({
    where: { githubId: repository.id },
  });

  if (!repo) {
    log.warn({ githubRepoId: repository.id }, 'repository not found in DB — skipping');
    return;
  }

  if (!repo.enabled) {
    log.debug({ repositoryId: repo.id }, 'repository not enabled — skipping review');
    return;
  }

  const commitSha = pr.head.sha;

  // Idempotent: if a review for this exact commit already exists, nothing to do.
  const existing = await prisma.aiReview.findUnique({
    where: {
      repositoryId_pullRequestNumber_commitSha: {
        repositoryId: repo.id,
        pullRequestNumber: pr.number,
        commitSha,
      },
    },
  });

  if (existing) {
    log.debug({ aiReviewId: existing.id, status: existing.status }, 'AiReview already exists — skipping');
    return;
  }

  // Create review row in PENDING state before enqueueing — the job can then
  // update it to RUNNING/COMPLETED/FAILED with a known ID.
  const aiReview = await prisma.aiReview.create({
    data: {
      repositoryId: repo.id,
      pullRequestNumber: pr.number,
      commitSha,
      status: 'PENDING',
    },
  });

  await boss.send(JobNames.ReviewPr, {
    repositoryId: repo.id,
    installationId: repo.installationId,
    pullRequestNumber: pr.number,
    commitSha,
    aiReviewId: aiReview.id,
  });

  log.info(
    { aiReviewId: aiReview.id, prNumber: pr.number, commitSha: commitSha.slice(0, 8) },
    'review.pr enqueued',
  );
}

// ---------------------------------------------------------------------------
// installation
// ---------------------------------------------------------------------------

const installationPayloadSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int() }),
}).passthrough();

async function handleInstallationEvent(
  payload: unknown,
  ctx: { prisma: PrismaClient; log: Logger },
): Promise<void> {
  const { prisma, log } = ctx;

  const parsed = installationPayloadSchema.safeParse(payload);
  if (!parsed.success) return;

  const { action, installation } = parsed.data;

  if (action === 'suspend') {
    await prisma.installation.updateMany({
      where: { githubId: installation.id },
      data: { suspended: true },
    });
    log.info({ githubInstallationId: installation.id }, 'installation suspended');
  } else if (action === 'unsuspend') {
    await prisma.installation.updateMany({
      where: { githubId: installation.id },
      data: { suspended: false },
    });
    log.info({ githubInstallationId: installation.id }, 'installation unsuspended');
  } else {
    log.debug({ action }, 'installation action logged');
  }
}

// ---------------------------------------------------------------------------
// installation_repositories
// ---------------------------------------------------------------------------

const repoItemSchema = z.object({
  id: z.number().int(),
  full_name: z.string(),
  private: z.boolean().optional(),
});

const installationReposPayloadSchema = z.object({
  installation: z.object({ id: z.number().int() }),
  repositories_added: z.array(repoItemSchema).optional(),
  repositories_removed: z.array(repoItemSchema).optional(),
}).passthrough();

async function handleInstallationRepositoriesEvent(
  payload: unknown,
  ctx: { prisma: PrismaClient; log: Logger },
): Promise<void> {
  const { prisma, log } = ctx;

  const parsed = installationReposPayloadSchema.safeParse(payload);
  if (!parsed.success) return;

  const { installation, repositories_added, repositories_removed } = parsed.data;

  const dbInstallation = await prisma.installation.findFirst({
    where: { githubId: installation.id },
  });

  if (!dbInstallation) {
    log.warn({ githubInstallationId: installation.id }, 'installation not found — skipping repo sync');
    return;
  }

  if (repositories_added?.length) {
    for (const repo of repositories_added) {
      const parts = repo.full_name.split('/');
      const owner = parts[0];
      const name = parts[1];
      if (!owner || !name) continue;

      await prisma.repository.upsert({
        where: { githubId: repo.id },
        create: {
          installationId: dbInstallation.id,
          githubId: repo.id,
          owner,
          name,
          defaultBranch: 'main', // updated on first review or explicit sync
          enabled: false,        // user must explicitly enable per repo
        },
        update: {}, // preserve existing enabled / config state on re-add
      });
    }
    log.info({ count: repositories_added.length }, 'repositories_added upserted');
  }

  if (repositories_removed?.length) {
    const githubIds = repositories_removed.map((r) => r.id);
    await prisma.repository.updateMany({
      where: { githubId: { in: githubIds } },
      data: { enabled: false },
    });
    log.info({ count: repositories_removed.length }, 'repositories_removed disabled');
  }
}

// ---------------------------------------------------------------------------
// push — incremental re-index of changed files
// ---------------------------------------------------------------------------

const pushPayloadSchema = z.object({
  after: z.string().min(7), // HEAD commit SHA after the push
  ref: z.string(),          // kis branch par push kiya hai
  commits: z.array(
    z.object({
      added:    z.array(z.string()).optional(),
      modified: z.array(z.string()).optional(),
      removed:  z.array(z.string()).optional(),
    }),
  ).optional(),
  repository: z.object({ id: z.number().int() }),
  installation: z.object({ id: z.number().int() }).optional(),
}).passthrough();

async function handlePushEvent(
  payload: unknown,
  ctx: { prisma: PrismaClient; boss: Boss; log: Logger },
): Promise<void> {
  const { prisma, boss, log } = ctx;

  const parsed = pushPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues }, 'push payload malformed — skipping');
    return;
  }

  const { after: headSha, commits, repository } = parsed.data;

  const repo = await prisma.repository.findFirst({
    where: { githubId: repository.id },
  });

  if (!repo?.enabled || repo.ingestionState !== 'ACTIVE') {
    log.debug({ githubRepoId: repository.id }, 'push: repo not enabled or not yet indexed — skipping');
    return;
  }

  // Collect unique changed/added paths across all commits in the push.
  const changedPaths = new Set<string>();
  for (const commit of commits ?? []) {
    for (const p of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
      changedPaths.add(p);
    }
  }

  if (changedPaths.size === 0) return;

  log.info({ changedFiles: changedPaths.size }, 'push: enqueueing index.file jobs');

  for (const filePath of changedPaths) {
    await boss.send(JobNames.IndexFile, {
      repositoryId: repo.id,
      installationId: repo.installationId,
      filePath,
      ref: headSha,
    });
  }
}
