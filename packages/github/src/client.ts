/**
 * Tiny authenticated-GET wrapper for the GitHub REST API.
 *
 * Centralizes the headers every request must send (Accept, API version,
 * User-Agent) and the non-2xx error shape, so resource modules (users.ts,
 * installations.ts, ...) stay focused on parsing the response body.
 *
 * Why direct fetch (not Octokit): see the package README. Phase 2 ingestion
 * uses Octokit with its own rate-limit-aware request layer; this wrapper
 * exists only for the small sign-in surface.
 */

const COMMON_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'rag-engineering-memory',
} as const;

export interface GhGetOptions {
  /**
   * HTTP statuses that should NOT throw — useful when an endpoint returning
   * 403/404 has a meaningful "absent" interpretation (e.g., App lacks the
   * permission to read this resource).
   */
  allowStatuses?: readonly number[];
}

export interface GhGetResult<T> {
  status: number;
  data: T | null;
}

/** Authenticated GET. Throws on non-2xx unless allow-listed. */
export async function ghGet<T>(
  url: string,
  accessToken: string,
  opts: GhGetOptions = {},
): Promise<GhGetResult<T>> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...COMMON_HEADERS,
    },
  });

  if (!response.ok) {
    if (opts.allowStatuses?.includes(response.status)) {
      return { status: response.status, data: null };
    }
    throw new Error(`GitHub ${url} failed: ${response.status}`);
  }

  return { status: response.status, data: (await response.json()) as T };
}
