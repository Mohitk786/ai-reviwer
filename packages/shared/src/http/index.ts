/**
 * Transport-agnostic HTTP helpers. Importable from any package without pulling
 * in Next.js, Express, or any framework.
 */

export { mapErrorToResponse, type ApiErrorBody, type MappedError } from './error-response';
