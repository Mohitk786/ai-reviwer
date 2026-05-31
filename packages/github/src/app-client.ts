/**
 * GitHubAppClient — minted-installation Octokit factory for ingestion + webhooks.
 *
 * Scope: M2+. Sign-in (OAuth) does NOT use this — see oauth.ts.
 *
 * What it provides:
 *   - `forInstallation(id)` → an `Octokit` instance authenticated as that installation,
 *     ready for REST (`.rest.pulls.list(...)`) or GraphQL (`.graphql(query, vars)`).
 *   - Per-installation caching: one Octokit per installation lives for the process
 *     lifetime. Inside it, `@octokit/auth-app` mints + caches the 1-hour installation
 *     token and refreshes proactively before expiry.
 *   - Throttling: `@octokit/plugin-throttling` retries primary rate-limit errors
 *     up to 2 times with the server-suggested `Retry-After`. Secondary
 *     (abuse-detection) limits do NOT auto-retry — those signal a real problem
 *     (parallel job storm, search abuse) that needs human attention.
 *
 * One process = one `GitHubAppClient` = one cache. Web and worker each build
 * their own; that's fine, each has its own per-installation token cache.
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { throttling } from '@octokit/plugin-throttling';

const ThrottledOctokit = Octokit.plugin(throttling);

/** Minimal logger shape — the pino logger from @repo/observability satisfies this. */
export interface GhClientLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface GitHubAppClientConfig {
  appId: number;
  /** PEM-encoded RSA private key from the App settings page. */
  privateKey: string;
  logger: GhClientLogger;
}

export class GitHubAppClient {
  private readonly cache = new Map<number, Octokit>();

  constructor(private readonly config: GitHubAppClientConfig) {
    if (!config.privateKey) {
      throw new Error('GitHubAppClient: privateKey is required');
    }
    if (!config.appId) {
      throw new Error('GitHubAppClient: appId is required');
    }
  }

  /**
   * Returns an Octokit authenticated as the given installation. Cached per id.
   *
   * Use the returned client like:
   *   `const { data } = await client.rest.pulls.list({ owner, repo });`
   *   `const data = await client.graphql<MyQuery>(QUERY, { owner, repo });`
   */
  forInstallation(installationId: number): Octokit {
    const cached = this.cache.get(installationId);
    if (cached) return cached;

    const log = this.config.logger;
    const octokit = new ThrottledOctokit({
      authStrategy: createAppAuth,
      auth: {
        appId: this.config.appId,
        privateKey: this.config.privateKey,
        installationId,
      },
      throttle: {
        // Primary rate limit (5K/hour per installation). Honor server Retry-After.
        onRateLimit: (retryAfter, options, _octo, retryCount) => {
          log.warn(
            {
              installationId,
              retryAfter,
              retryCount,
              method: options.method,
              url: options.url,
            },
            'github primary rate limit',
          );
          return retryCount < 2;
        },
        // Secondary rate limit = abuse detection. Don't auto-retry.
        onSecondaryRateLimit: (retryAfter, options) => {
          log.warn(
            {
              installationId,
              retryAfter,
              method: options.method,
              url: options.url,
            },
            'github secondary rate limit (abuse) — not auto-retrying',
          );
          return false;
        },
      },
    });

    this.cache.set(installationId, octokit);
    return octokit;
  }

  /** Test helper. Drops the cache so the next call mints fresh tokens. */
  resetCache(): void {
    this.cache.clear();
  }
}
