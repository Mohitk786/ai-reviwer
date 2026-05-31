# @repo/github

Centralized GitHub App client. Every GitHub API call in the system flows through here.

## Why centralize

- **Rate-limit accounting**: GitHub Apps have per-installation rate limits. Tracking
  remaining quota requires a single chokepoint.
- **Token rotation**: installation tokens are short-lived (1 hour) and minted on demand
  via JWT signed with the App private key. Client caches them.
- **Webhook verification**: HMAC-SHA-256 verification logic lives in one place.

## Phase 1 status

Scaffolding only. Interfaces are locked in so dependent packages can compile, but full
implementation (Octokit wrapping, rate limiter, GraphQL client) lands in **M2 — Ingestion**.

## Phase 1 public API

```ts
import type { GitHubClient, GitHubAppConfig } from '@repo/github';
```

## Future API (M2)

```ts
const gh = createGitHubClient(config);
const installClient = await gh.forInstallation(installationId);
await installClient.graphql(`query { ... }`);
```
