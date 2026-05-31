/**
 * @repo/flags — Feature flag reads with a 5-minute in-process cache.
 *
 * Per requirements: flipping a flag in the DB should take effect within 5 minutes
 * across all replicas, with NO redeploy and NO push-invalidation infrastructure.
 *
 * Implementation: each replica caches reads independently. Max staleness across replicas
 * = TTL = 5 minutes — exactly the stated SLA.
 *
 * Used to gate (a) billing enforcement, (b) experimental features (rerank, parallel
 * ingestion), (c) per-installation rollouts.
 */

export { FeatureFlagService, FlagKeys, type FlagKey } from './service';
