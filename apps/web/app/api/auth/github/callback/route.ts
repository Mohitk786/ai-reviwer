
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@repo/shared';
import { isAppError } from '@repo/shared/errors';
import { setUserContext } from '@repo/observability';
import { getContainer } from '@/server/container';
import {
  consumeStateCookie,
  setSession,
  statesMatch,
} from '@/server/session';
import { withRouteContext } from '@/server/middleware/with-route-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SafeError =
  | 'state_mismatch'
  | 'missing_params'
  | 'github_error'
  | 'auth_failed'
  | 'unknown';

function redirectWithError(req: NextRequest, error: SafeError): NextResponse {
  const url = new URL('/?error=' + error, req.url);
  return NextResponse.redirect(url, { status: 302 });
}

export const GET = withRouteContext(async (req) => {
  const env = getEnv();
  const c = await getContainer();
  const log = c.logger.child({ route: 'auth.callback' });

  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const installationIdRaw = params.get('installation_id'); // present on first install, absent on re-login
  const stateFromQuery = params.get('state');

  // 1. Required-param check — installation_id is optional (absent on re-login via OAuth authorize).
  if (!code || !stateFromQuery) {
    log.warn({ hasCode: !!code, hasState: !!stateFromQuery }, 'callback missing required params');
    return redirectWithError(req, 'missing_params');
  }

  const installationId = installationIdRaw ? Number(installationIdRaw) : null;
  if (installationId !== null && (!Number.isInteger(installationId) || installationId <= 0)) {
    log.warn({ installationIdRaw }, 'callback installation_id not a positive integer');
    return redirectWithError(req, 'missing_params');
  }

  // 2. CSRF state check.
  const stateFromCookie = await consumeStateCookie();
  if (!stateFromCookie || !statesMatch(stateFromCookie, stateFromQuery)) {
    log.warn(
      { hasCookie: !!stateFromCookie },
      'callback state mismatch — possible CSRF or expired session',
    );
    return redirectWithError(req, 'state_mismatch');
  }

  // 3. Hand off to service.
  try {
    const result = await c.auth.completeSignIn({
      code,
      installationId: installationId ?? undefined,
    });

    // Promote userId / installationId into request context so any subsequent
    // logs (and the wrapper's request-complete log) auto-include them.
    setUserContext({ userId: result.userId, installationId: result.installationId });

    log.info(
      { userId: result.userId, installationId: result.installationId, isNewUser: result.isNewUser },
      'sign-in complete',
    );

    // 4. Issue session.
    await setSession(result.userId, env.SESSION_SECRET);

    // 5. Redirect to onboarding.
    return NextResponse.redirect(new URL('/onboarding', req.url), { status: 302 });
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ err, code: err.code }, 'sign-in rejected');
      const safe: SafeError =
        err.code === 'AUTH_REQUIRED' || err.code === 'FORBIDDEN'
          ? 'auth_failed'
          : 'github_error';
      return redirectWithError(req, safe);
    }
    log.error({ err }, 'sign-in unexpected failure');
    return redirectWithError(req, 'unknown');
  }
});
