
import type { PrismaClient } from '@repo/db';
import type { GitHubAppClient } from '@repo/github';
import type Boss from 'pg-boss';
import { JobNames } from '@repo/jobs';
import { AuthError, NotFoundError } from '@repo/shared/errors';

export interface AccessibleRepo {
  /** GitHub's numeric repo id. Stable even if the repo is renamed. */
  githubId: number;
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
  /** If non-null, this repo already has a row in our DB (enabled or not). */
  ourId: string | null;
  enabled: boolean;
}

export interface EnableRepoInput {
  userId: string;
  installationId: string;
  /** GitHub's numeric repo id. Lookup key when GH renames/transfers a repo. */
  githubId: number;
  owner: string;
  name: string;
  defaultBranch: string;
}

export class RepositoryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly github: GitHubAppClient,
    private readonly boss: Boss,
  ) {}

  async listAccessible(input: {
    userId: string;
    installationId: string;
  }): Promise<AccessibleRepo[]> {
    const installation = await this.requireMembership(input.userId, input.installationId);

    // Step 1 — ask GitHub which repos this installation can see.
    // The 100-per-page limit is GitHub's. For installations with more repos
    // we'd paginate; M2 demo fits in one page.
    const octokit = this.github.forInstallation(installation.githubId);
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
      per_page: 100,
    });

    // Step 2 — what do we already have in our DB for this installation?
    // One query covers all of them; saves N round-trips.
    const ourRepos = await this.prisma.repository.findMany({
      where: { installationId: input.installationId },
      select: { id: true, githubId: true, enabled: true },
    });
    const ourReposByGithubId = new Map(ourRepos.map((r) => [r.githubId, r]));

    // Step 3 — merge. For each GitHub repo, attach our DB state if any.
    return data.repositories.map((repo) => {
      const ours = ourReposByGithubId.get(repo.id);
      return {
        githubId: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        defaultBranch: repo.default_branch ?? 'main',
        isPrivate: repo.private,
        ourId: ours?.id ?? null,
        enabled: ours?.enabled ?? false,
      };
    });
  }

 
  async enable(input: EnableRepoInput): Promise<{ repositoryId: string }> {
    await this.requireMembership(input.userId, input.installationId);

    const previousState = await this.prisma.repository.findUnique({
      where: { githubId: input.githubId },
      select: { enabled: true, ingestionState: true },
    });

    const repo = await this.prisma.repository.upsert({
      where: { githubId: input.githubId },
      create: {
        installationId: input.installationId,
        githubId: input.githubId,
        owner: input.owner,
        name: input.name,
        defaultBranch: input.defaultBranch,
        enabled: true,
      },
      update: {
        owner: input.owner,
        name: input.name,
        defaultBranch: input.defaultBranch,
        enabled: true,
      },
    });

    // Kick off codebase indexing if the repo was just enabled (new or re-enabled).
    const wasDisabled = !previousState || !previousState.enabled;
    const notYetIndexed = !previousState || previousState.ingestionState === 'NOT_STARTED';
    if (wasDisabled || notYetIndexed) {
      await this.boss.send(JobNames.IndexRepository, {
        repositoryId: repo.id,
        installationId: input.installationId,
      });
    }

    return { repositoryId: repo.id };
  }

  /**
   * Turn ingestion off. Sets enabled=false; in-flight worker jobs see this
   * flag and bail out on their next iteration. Already-ingested PRs/comments
   * stay in the DB — re-enabling later will pick up where we left off.
   */
  async disable(input: { userId: string; repositoryId: string }): Promise<void> {
    const repo = await this.prisma.repository.findUnique({
      where: { id: input.repositoryId },
      select: { installationId: true },
    });
    if (!repo) throw new NotFoundError(`Repository ${input.repositoryId} not found`);

    await this.requireMembership(input.userId, repo.installationId);

    await this.prisma.repository.update({
      where: { id: input.repositoryId },
      data: { enabled: false },
    });
  }

  /**
   * Internal guard: throws AuthError if `userId` is not a member of
   * `installationId`. Returns the Installation row on success so callers
   * don't need to fetch it again.
   */
  private async requireMembership(userId: string, installationId: string) {
    const link = await this.prisma.installationUser.findUnique({
      where: {
        installationId_userId: { installationId, userId },
      },
      select: {
        installation: {
          select: { id: true, githubId: true, suspended: true },
        },
      },
    });
    if (!link) {
      throw new AuthError(
        `User ${userId} is not a member of installation ${installationId}`,
      );
    }
    if (link.installation.suspended) {
      throw new AuthError(
        `Installation ${installationId} is suspended — re-authorize the GitHub App first`,
      );
    }
    return link.installation;
  }
}
