import { redirect } from 'next/navigation';
import { Building2, User } from 'lucide-react';
import { GitHubIcon } from '@/components/icons/github';
import { getEnv } from '@repo/shared';
import { isAppError } from '@repo/shared/errors';
import { getSession } from '@/server/session';
import { getContainer } from '@/server/container';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { enableRepoAction, disableRepoAction } from './actions';
import type { AccessibleRepo } from '@repo/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InstallationView = {
  id: string;
  githubId: number;
  accountLogin: string;
  accountType: 'USER' | 'ORGANIZATION';
  suspended: boolean;
};

export default async function OnboardingPage() {
  const env = getEnv();
  const session = await getSession(env.SESSION_SECRET);
  if (!session) redirect('/');

  const c = await getContainer();
  const user = await c.auth.getUserById(session.userId);
  if (!user) {
    // Session JWT was valid but the user row was deleted (admin action,
    // GDPR delete, etc.). Treat as signed out.
    redirect('/');
  }

  // For each installation, ask GitHub for the accessible repos. We do these
  // requests in parallel because they are independent. If one fails, the
  // others still show — we attach the error to that one card.
  const cards = await Promise.all(
    user.installations.map(async ({ installation }) => {
      const view: InstallationView = {
        id: installation.id,
        githubId: installation.githubId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        suspended: installation.suspended,
      };

      // Don't bother hitting GitHub for an installation the org admin
      // suspended — the API would error and we know what to display anyway.
      if (installation.suspended) {
        return { installation: view, repos: [], error: 'Installation is suspended on GitHub.' };
      }

      try {
        const repos = await c.repositories.listAccessible({
          userId: user.id,
          installationId: installation.id,
        });
        return { installation: view, repos, error: null as string | null };
      } catch (err) {
        // Surface a friendly message; full error is in server logs.
        c.logger.warn(
          { err, installationId: installation.id },
          'onboarding: failed to list repos',
        );
        const message = isAppError(err) ? err.message : 'Could not load repositories.';
        return { installation: view, repos: [] as AccessibleRepo[], error: message };
      }
    }),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-16">
      <header className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={`${user.githubLogin} avatar`}
              className="size-10 rounded-full"
              width={40}
              height={40}
            />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-full bg-muted">
              <User className="size-5" />
            </div>
          )}
          <div>
            <p className="text-sm text-muted-foreground">Signed in as</p>
            <p className="font-mono">@{user.githubLogin}</p>
          </div>
        </div>

        <form action="/api/auth/signout" method="post">
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </header>

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Choose repos to ingest</h1>
          <p className="mt-2 text-muted-foreground">
            Click Enable on a repo and we&apos;ll start importing its pull requests in
            the background. You can disable any repo later — your data stays.
          </p>
        </div>

        {cards.length === 0 && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                No installations connected. Re-run sign-in to add one.
              </p>
            </CardContent>
          </Card>
        )}

        {cards.map(({ installation, repos, error }) => (
          <Card key={installation.id}>
            <CardHeader className="flex flex-row items-center gap-3 space-y-0">
              {installation.accountType === 'ORGANIZATION' ? (
                <Building2 className="size-5 text-muted-foreground" />
              ) : (
                <User className="size-5 text-muted-foreground" />
              )}
              <div className="flex-1">
                <CardTitle className="text-base font-mono">
                  {installation.accountLogin}
                </CardTitle>
                <CardDescription className="text-xs">
                  {installation.accountType.toLowerCase()} · installation #
                  {installation.githubId}
                  {installation.suspended && ' · suspended'}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : repos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No repositories are accessible to this installation.
                </p>
              ) : (
                <ul className="divide-y">
                  {repos.map((repo) => (
                    <RepoRow
                      key={repo.githubId}
                      repo={repo}
                      installationId={installation.id}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}

        <div className="pt-4">
          <Button asChild>
            <a href="/api/auth/github/start" className="inline-flex">
              <GitHubIcon className="size-4" />
              Connect another installation
            </a>
          </Button>
        </div>
      </div>
    </main>
  );
}

/**
 * One row in the repo list: name on the left, status + button on the right.
 *
 * Why two separate <form>s instead of one with a "toggle" action?
 * Each form submits ONE intent (enable OR disable). The hidden inputs differ
 * between the two paths (enable needs full repo metadata; disable just needs
 * the cuid). Two forms keeps each one's payload tight and lets the action
 * functions stay narrow.
 */
function RepoRow({
  repo,
  installationId,
}: {
  repo: AccessibleRepo;
  installationId: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm">
          {repo.owner}/{repo.name}
          {repo.isPrivate && (
            <span className="ml-2 text-xs text-muted-foreground">private</span>
          )}
        </p>
      </div>

      {repo.enabled && (
        <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-900">
          active
        </span>
      )}

      {repo.enabled && repo.ourId ? (
        <form action={disableRepoAction}>
          <input type="hidden" name="repositoryId" value={repo.ourId} />
          <Button type="submit" variant="ghost" size="sm">
            Disable
          </Button>
        </form>
      ) : (
        <form action={enableRepoAction}>
          {/* Hidden inputs carry every field the server action needs to
              create the Repository row. We send GH's numeric id (stable
              across renames) plus owner/name/branch (so we don't have to
              re-fetch from GitHub inside the action). */}
          <input type="hidden" name="installationId" value={installationId} />
          <input type="hidden" name="githubId" value={repo.githubId} />
          <input type="hidden" name="owner" value={repo.owner} />
          <input type="hidden" name="name" value={repo.name} />
          <input type="hidden" name="defaultBranch" value={repo.defaultBranch} />
          <Button type="submit" size="sm">
            Enable
          </Button>
        </form>
      )}
    </li>
  );
}

