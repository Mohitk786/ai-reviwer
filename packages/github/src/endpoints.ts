/**
 * GitHub REST API endpoints used by the sign-in flow.
 *
 * Co-located here so additions during M2 (ingestion) don't sprawl across
 * resource modules. Each endpoint is referenced by exactly one fetcher in
 * this package.
 */

export const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
export const API_USER = 'https://api.github.com/user';
export const API_USER_INSTALLATIONS =
  'https://api.github.com/user/installations?per_page=100';
