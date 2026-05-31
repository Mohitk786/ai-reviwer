/**
 * @repo/github — GitHub integration surface.
 *
 * Sign-in flow:
 *   - oauth.ts            : install URL builder + code-for-token exchange
 *   - users.ts            : authenticated-user profile fetch
 *   - installations.ts    : list user's GitHub App installations
 *   - client.ts           : shared `ghGet` wrapper (headers, error mapping)
 *   - endpoints.ts        : URL constants
 *
 * App client (ingestion + review):
 *   - app-client.ts       : `GitHubAppClient` — installation-scoped Octokit
 *                           with token minting + rate-limit-aware retry.
 *
 * Review API:
 *   - review-client.ts    : `listPRFiles`, `createPRReview`, `getPRMetadata`.
 *
 * Webhooks:
 *   - webhook-verifier.ts : `verifyGithubSignature` — HMAC-SHA256 timing-safe verify.
 */

export * from './oauth';
export * from './users';
export * from './installations';
export * from './app-client';
export * from './review-client';
export * from './webhook-verifier';
