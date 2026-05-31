/**
 * Entitlement contract — used by EntitlementService and tRPC handlers.
 *
 * The action enum lists every metered/gated operation in the product. Adding a
 * new gated action: append to this enum + handle in EntitlementService.check().
 */

import { z } from 'zod';

export const EntitlementActionSchema = z.enum([
  'query',
  'enable_repo',
  'ingest_tokens',
  'embed_tokens',
]);
export type EntitlementAction = z.infer<typeof EntitlementActionSchema>;

export const EntitlementContextSchema = z.object({
  installationId: z.string(),
  /** How many "units" the action will consume (queries: 1, tokens: actual count). */
  cost: z.number().int().nonnegative().default(1),
});
export type EntitlementContext = z.infer<typeof EntitlementContextSchema>;

export const EntitlementResultSchema = z.object({
  allowed: z.boolean(),
  reason: z
    .enum([
      'flag_off_default_allowed',
      'within_limits',
      'no_active_subscription',
      'plan_limit_exceeded',
      'feature_disabled',
    ])
    .optional(),
  /** Remaining units in current period (if known and meaningful). */
  remaining: z.number().int().nonnegative().optional(),
});
export type EntitlementResult = z.infer<typeof EntitlementResultSchema>;
