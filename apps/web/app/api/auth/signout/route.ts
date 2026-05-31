/**
 * POST /api/auth/signout
 *
 * Clears the session cookie and redirects to the home page.
 *
 * POST (not GET) so that prefetchers / link-scanners can't sign users out
 * accidentally. The home page submits this via a tiny <form method="post">.
 */

import { NextResponse } from 'next/server';
import { clearSession } from '@/server/session';
import { withRouteContext } from '@/server/middleware/with-route-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withRouteContext(async (req) => {
  await clearSession();
  return NextResponse.redirect(new URL('/', req.url), { status: 302 });
});
