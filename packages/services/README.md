# @repo/services

The application service layer. **All business logic lives here.**

## Rules

1. tRPC routers in `apps/web` are thin — parse Zod, call a service, return result.
2. Routers must NOT touch `@repo/db` directly. Services are the only DB consumers in
   transport-layer code paths.
3. Services are CLASSES with constructor injection. No static methods, no module-level
   singletons of business state.
4. Services may depend on other services (e.g., `RetrievalService` depends on
   `EntitlementService`). The DI container in `apps/web/src/server/container.ts` wires them.

## Phase 1 services

- `ProviderCredentialService` — store, validate (via `provider.validate()`), and decrypt
  user-supplied LLM API keys.
- `SubscriptionService` — read/write Subscription + UsageMeter; meter increments use
  `SELECT ... FOR UPDATE` for race safety.
- `EntitlementService` — answer "can installation X perform action Y, costing Z units?"
  Short-circuits to allowed when `billing.enforcement` flag is off.

## Phase 2+ services (designed for, not implemented yet)

`RepositoryService`, `IngestionService`, `RetrievalService`, `QueryService`, `AuthService`.

## Pattern example

```ts
export class EntitlementService {
  constructor(
    private prisma: PrismaClient,
    private flags: FeatureFlagService,
  ) {}

  async check(input: { installationId: string; action: EntitlementAction; cost?: number }) {
    const enforcing = await this.flags.isEnabled(FlagKeys.BillingEnforcement, {
      installationId: input.installationId,
    });
    if (!enforcing) return { allowed: true, reason: 'flag_off_default_allowed' };
    // ... real check ...
  }
}
```
