/**
 * GET /api/auth/github/start
 *
 * Sign-in entry point. Redirects the user to GitHub's install/authorize URL.
 *
 * Flow:
 *   1. Generate a CSRF state token (32 random bytes hex).
 *   2. Store it in an `httpOnly` cookie (10-min TTL, single-use).
 *   3. 302 redirect to https://github.com/apps/<slug>/installations/new?state=...
 *
 * GitHub will:
 *   - Show the install picker (or skip if already installed).
 *   - Prompt for OAuth authorization (since the App is configured to "Request
 *     user authorization (OAuth) during installation").
 *   - Redirect back to /api/auth/github/callback with `code`, `installation_id`,
 *     and `state` query params.
 */

import { NextResponse } from 'next/server';
import { buildInstallUrl } from '@repo/github';
import { getEnv } from '@repo/shared';
import { generateState, setStateCookie } from '@/server/session';
import { withRouteContext } from '@/server/middleware/with-route-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withRouteContext(async () => {
  const env = getEnv();

  const state = generateState();
  await setStateCookie(state);

  const url = buildInstallUrl({
    slug: env.GITHUB_APP_SLUG,
    clientId: env.GITHUB_APP_CLIENT_ID,
    state,
  });

  return NextResponse.redirect(url, { status: 302 });
});
