/**
 * AuthService — orchestrates the GitHub App sign-in flow.
 *
 * Inputs (from the callback route):
 *   - `code`                  : OAuth code from GitHub's redirect.
 *   - `installationId`        : numeric GH installation id from the redirect.
 *
 * Steps:
 *   1. Exchange `code` for a user access token.
 *   2. Fetch the GitHub user's profile.
 *   3. Fetch the user's installations to learn the account info for `installationId`
 *      (login + USER/ORGANIZATION).
 *   4. In one transaction:
 *      - Upsert User by `githubId`.
 *      - Upsert Installation by `githubId`.
 *      - Link them via InstallationUser (idempotent).
 *      - Ensure a Free-plan Subscription exists (idempotent).
 *
 * Returns the internal `userId` and `installationId` so the route handler can
 * issue a session cookie and redirect to `/onboarding`.
 *
 * Security note: this service is the ONLY place we hand a user access token
 * around. We never log it (pino redactions cover `Authorization`, `apiKey`,
 * `secret`, `token`).
 */

import type { PrismaClient } from '@repo/db';
import {
  exchangeUserCode,
  fetchAuthorizedUser,
  fetchUserInstallations,
} from '@repo/github';
import { AuthError, UpstreamError } from '@repo/shared/errors';
import type { SubscriptionService } from './SubscriptionService';

export interface AuthServiceConfig {
  clientId: string;
  clientSecret: string;
}

export interface CompleteSignInInput {
  code: string;
  /** Present on first install (GitHub includes it in the callback).
   *  Absent on re-login via OAuth authorize — we resolve it from the user token. */
  installationId?: number;
}

export interface CompleteSignInResult {
  userId: string;
  installationId: string;
  /** True when the User row was inserted by this call (vs. updated). */
  isNewUser: boolean;
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly subscriptions: SubscriptionService,
    private readonly config: AuthServiceConfig,
  ) {}

  /**
   * Run the post-callback steps of GitHub App sign-in. Throws:
   *   - `UpstreamError` on a GitHub failure (token exchange, profile fetch).
   *   - `AuthError` if the supplied `installationId` isn't visible to the user
   *     (i.e., the user didn't actually grant access to it).
   */
  async completeSignIn(input: CompleteSignInInput): Promise<CompleteSignInResult> {
   
    // Step 1: token exchange.
    let token;
    try {
      token = await exchangeUserCode({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        code: input.code,
      });
    } catch (err) {
      throw new UpstreamError('GitHub', 'token exchange failed', err);
    }

    // Steps 2 & 3 — run in parallel, both use the user token.
    const [ghUser, installations] = await Promise.all([
      fetchAuthorizedUser(token.accessToken).catch((err) => {
        throw new UpstreamError('GitHub', 'user fetch failed', err);
      }),
      fetchUserInstallations(token.accessToken).catch((err) => {
        throw new UpstreamError('GitHub', 'installations fetch failed', err);
      }),
    ]);

    
    // If installationId was provided (first-time install), verify the user can see it.
    // If absent (re-login via OAuth), use the first installation associated with this user.
    const matched = input.installationId
      ? installations.find((i) => i.id === input.installationId)
      : installations[0];

    if (!matched) {
      throw new AuthError(
        input.installationId
          ? `Installation ${input.installationId} not visible to authenticated user`
          : 'No GitHub App installation found for this user — install the app first',
      );
    }

    // Step 4: persist in one transaction.
    return await this.prisma.$transaction(async (tx) => {
      const beforeUserCount = await tx.user.count({ where: { githubId: ghUser.id } });

      const user = await tx.user.upsert({
        where: { githubId: ghUser.id },
        create: {
          githubId: ghUser.id,
          githubLogin: ghUser.login,
          email: ghUser.email,
          avatarUrl: ghUser.avatarUrl,
        },
        update: {
          githubLogin: ghUser.login,
          email: ghUser.email,
          avatarUrl: ghUser.avatarUrl,
        },
      });

      const installation = await tx.installation.upsert({
        where: { githubId: matched.id },
        create: {
          githubId: matched.id,
          accountLogin: matched.accountLogin,
          accountType: matched.accountType,
        },
        update: {
          accountLogin: matched.accountLogin,
          accountType: matched.accountType,
          // If this was previously suspended (e.g., uninstalled then reinstalled),
          // un-suspend now that the user re-authorized.
          suspended: false,
        },
      });

      await tx.installationUser.upsert({
        where: {
          installationId_userId: {
            installationId: installation.id,
            userId: user.id,
          },
        },
        create: {
          installationId: installation.id,
          userId: user.id,
          // First user to install gets OWNER. Refinement (proper org admin
          // detection) is M1.5+ work.
          role: 'OWNER',
        },
        update: {},
      });

      return {
        userId: user.id,
        installationId: installation.id,
        isNewUser: beforeUserCount === 0,
      };
    }).then(async (result) => {
      //  SubscriptionService has its own transactions and we don't want nested.
      await this.subscriptions.ensureFreePlanFor(result.installationId);
      return result;
    });
  }

  async getUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        installations: {
          include: {
            installation: true,
          },
        },
      },
    });
  }
}
