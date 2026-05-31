/**
 * @repo/services — Application service layer. ALL business logic lives here.
 *
 * Architectural rule: tRPC routers (in apps/web) are THIN. They:
 *   1. Parse input via Zod.
 *   2. Call a service method.
 *   3. Return / format the result.
 *
 * Services own:
 *   - Authorization checks ("can this user enable this repo?")
 *   - Entitlement checks (subscription + plan limits)
 *   - Provider resolution (which LLM does this installation use?)
 *   - Multi-step orchestration (e.g., enable repo → enqueue ingestion job)
 *
 * Each service is a class with constructor injection — no static methods, no globals.
 * Tests pass stubs into the constructor. The DI container wires real implementations.
 */

export { ProviderCredentialService } from './ProviderCredentialService';
export { SubscriptionService } from './SubscriptionService';
export { EntitlementService } from './EntitlementService';
export { AuthService } from './AuthService';
export type {
  AuthServiceConfig,
  CompleteSignInInput,
  CompleteSignInResult,
} from './AuthService';
export { RepositoryService } from './RepositoryService';
export type { AccessibleRepo, EnableRepoInput } from './RepositoryService';
