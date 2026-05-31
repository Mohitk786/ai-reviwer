/**
 * Authenticated-user resource fetchers.
 *
 * Note on `email`: the `/user` endpoint returns `null` for any user with
 * "Keep my email addresses private" enabled (the GitHub default). To get
 * a usable email, query `/user/emails` with the App's email permission.
 * That helper isn't in this file yet — see TODO in AuthService.
 */

import { ghGet } from './client';
import { API_USER } from './endpoints';

export interface AuthorizedUser {
  id: number;
  login: string;
  email: string | null;
  avatarUrl: string | null;
}

/** Fetch the authenticated user's profile. */
export async function fetchAuthorizedUser(accessToken: string): Promise<AuthorizedUser> {
  const { data } = await ghGet<{
    id: number;
    login: string;
    email: string | null;
    avatar_url: string | null;
  }>(API_USER, accessToken);

  const profile = data!;
  return {
    id: profile.id,
    login: profile.login,
    email: profile.email,
    avatarUrl: profile.avatar_url,
  };
}
