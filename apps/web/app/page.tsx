/**
 * Landing page.
 *
 * Server component — checks the session cookie:
 *   - Signed in   → redirects to /onboarding.
 *   - Signed out  → renders the marketing card with a wired GitHub sign-in button.
 *
 * URL-level error states are surfaced via `?error=…` (set by the auth callback
 * on failure). Whitelist enforced; any unknown value is shown as 'unknown'.
 */

import { redirect } from 'next/navigation';
import { getEnv } from '@repo/shared';
import { getSession } from '@/server/session';
import { GitHubIcon } from '@/components/icons/github';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: 'Sign-in expired or was tampered with. Try again.',
  missing_params: 'GitHub callback was incomplete. Try again.',
  github_error: 'GitHub rejected the sign-in. Check your app credentials.',
  auth_failed: 'You tried to sign in with an installation you don’t own.',
  unknown: 'Sign-in failed. Try again.',
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const env = getEnv();
  const session = await getSession(env.SESSION_SECRET);
  if (session) {
    redirect('/onboarding');
  }

  const params = await searchParams;
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.unknown : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-24">
      <div className="w-full space-y-8">
        <header className="space-y-3 text-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Engineering memory for your team
          </h1>
          <p className="text-pretty text-lg text-muted-foreground">
            Ask your repo:{' '}
            <span className="font-mono text-foreground">have we seen this issue before?</span>
          </p>
        </header>

        {errorMessage && (
          <Card className="border-destructive/50">
            <CardContent className="pt-6 text-sm text-destructive">{errorMessage}</CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Get started</CardTitle>
            <CardDescription>
              Connect a GitHub installation. We index PRs, issues, comments, and commits — then
              you ask questions in natural language. Every answer cites the original GitHub
              source.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="lg" className="w-full sm:w-auto" asChild>
              <a href="/api/auth/github/start">
                <GitHubIcon className="size-5" />
                Sign in with GitHub
              </a>
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          M1 — auth flow live. Repo selection + ingestion ships in next iteration.
        </p>
      </div>
    </main>
  );
}
