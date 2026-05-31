/**
 * GitHub PR review API — list files, post review + inline comments.
 *
 * Why standalone functions (not GitHubAppClient methods): the App client is
 * already well-scoped to "give me an authenticated Octokit for installation N".
 * Adding review-specific operations would couple review logic to the core auth
 * plumbing. Instead, these functions take a `GitHubAppClient` dependency and
 * call `forInstallation` internally.
 *
 * GitHub review API notes:
 *   - Uses the `line` + `side` variant of review comments (not the old `position`
 *     integer). Requires the diff to know which lines exist on the new side.
 *   - A submitted review is immutable — new commits require a new review.
 *   - `event: 'COMMENT'` never blocks merges. `REQUEST_CHANGES` does.
 *   - `githubReviewId` returned is a BigInt-safe integer; store as BIGINT in DB.
 */

import type { GitHubAppClient } from './app-client';

// ---------------------------------------------------------------------------
// PR file listing
// ---------------------------------------------------------------------------

export interface PRFile {
  filename: string;
  status:
    | 'added'
    | 'removed'
    | 'modified'
    | 'renamed'
    | 'copied'
    | 'changed'
    | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  /** Unified diff patch for this file. Absent for binary files or files above
   *  GitHub's ~20 KB threshold. */
  patch?: string;
  sha: string;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  /** Only present when status is 'renamed'. */
  previous_filename?: string;
}

/**
 * Returns all changed files for a PR (auto-paginates up to 3000 files).
 *
 * GitHub caps files per page at 100. Files beyond 3000 are silently dropped
 * by the API — a `maxFilesPerPr` config cap should prevent us from hitting this.
 */
export async function listPRFiles(
  github: GitHubAppClient,
  githubInstallationId: number,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PRFile[]> {
  const octokit = github.forInstallation(githubInstallationId);
  const files: PRFile[] = [];

  // Paginate: GitHub returns max 100 per page.
  let page = 1;
  while (true) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
      page,
    });

    files.push(...(data as PRFile[]));
    if (data.length < 100) break;
    page++;
  }

  return files;
}

// ---------------------------------------------------------------------------
// Review creation
// ---------------------------------------------------------------------------

export interface ReviewLineComment {
  /** Relative file path within the repo. */
  path: string;
  /** Actual new-file line number (not diff position). */
  line: number;
  /** Which diff side. 'RIGHT' for new-file lines (the common case). */
  side: 'LEFT' | 'RIGHT';
  /** Markdown comment body. Max 65536 chars — longer bodies are truncated before posting. */
  body: string;
}

export interface CreateReviewInput {
  owner: string;
  repo: string;
  pullNumber: number;
  /** The commit SHA to pin the review to. */
  commitId: string;
  /** PR-level summary shown in the "Files changed" view. */
  body: string;
  /** COMMENT = annotate only. REQUEST_CHANGES = blocks merge. */
  event: 'COMMENT' | 'REQUEST_CHANGES';
  /** Inline line-level comments. Empty array posts only a summary. */
  comments: ReviewLineComment[];
}

export interface CreateReviewResult {
  /** GitHub's review ID (BIGINT-safe). */
  reviewId: number;
}

const MAX_COMMENT_BODY_BYTES = 65_000;

/**
 * Creates a GitHub pull request review with a PR-level summary and optional
 * inline line comments.
 *
 * Edge cases handled:
 *   - Truncates comment bodies > 65 000 chars.
 *   - Submits an empty `comments` array if all comments were filtered out.
 *   - Uses the new `line`-based API (not the deprecated `position` integer).
 */
export async function createPRReview(
  github: GitHubAppClient,
  githubInstallationId: number,
  input: CreateReviewInput,
): Promise<CreateReviewResult> {
  const octokit = github.forInstallation(githubInstallationId);

  const comments = input.comments.map((c) => ({
    path: c.path,
    line: c.line,
    side: c.side,
    body:
      c.body.length > MAX_COMMENT_BODY_BYTES
        ? c.body.slice(0, MAX_COMMENT_BODY_BYTES) + '\n\n*[truncated]*'
        : c.body,
  }));

  const { data } = await octokit.rest.pulls.createReview({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    commit_id: input.commitId,
    body: input.body,
    event: input.event,
    comments,
  });

  return { reviewId: data.id };
}

// ---------------------------------------------------------------------------
// PR metadata helpers
// ---------------------------------------------------------------------------

export interface PRMetadata {
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  headRef: string;
  baseRef: string;
  state: string;
  merged: boolean;
  authorLogin: string | null;
  isDraft: boolean;
}

/** Fetch lightweight PR metadata — used by the review orchestrator to check if
 *  a PR is still open and to get the author login for ignore-list filtering. */
export async function getPRMetadata(
  github: GitHubAppClient,
  githubInstallationId: number,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PRMetadata> {
  const octokit = github.forInstallation(githubInstallationId);
  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  return {
    number: data.number,
    title: data.title,
    body: data.body ?? null,
    headSha: data.head.sha,
    headRef: data.head.ref,
    baseRef: data.base.ref,
    state: data.state,
    merged: data.merged ?? false,
    authorLogin: data.user?.login ?? null,
    isDraft: data.draft ?? false,
  };
}
