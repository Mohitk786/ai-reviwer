/**
 * GitHub App installation listing.
 *
 * Used after the OAuth callback to find the account info for the
 * `installation_id` we just received — without needing the App's private key
 * (that's only required for minting installation tokens during ingestion).
 */

import { ghGet } from './client';
import { API_USER_INSTALLATIONS } from './endpoints';

/** What we extract from each installation in /user/installations. */
export interface UserInstallation {
  id: number;
  accountLogin: string;
  accountType: 'USER' | 'ORGANIZATION';
}

/** List the installations available to this user. */
export async function fetchUserInstallations(
  accessToken: string,
): Promise<UserInstallation[]> {
  const { data } = await ghGet<{
    installations: Array<{
      id: number;
      account: { login: string; type: 'User' | 'Organization' };
    }>;
  }>(API_USER_INSTALLATIONS, accessToken);

  return data!.installations.map((i) => ({
    id: i.id,
    accountLogin: i.account.login,
    accountType: i.account.type === 'Organization' ? 'ORGANIZATION' : 'USER',
  }));
}
