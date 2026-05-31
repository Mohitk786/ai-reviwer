
import { z } from 'zod';
import { TOKEN_ENDPOINT } from './endpoints';


export function buildInstallUrl(input: { slug: string; state: string; clientId: string }): string {
  const url = new URL(`https://github.com/apps/${input.slug}/installations/new`);
  url.searchParams.set('state', input.state);
  return url.toString();
}

/** Token exchange response — only the fields we use. */
const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  scope: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
});

export interface UserToken {
  accessToken: string;
  /** Seconds until expiration; absent for non-rotating tokens. */
  expiresIn?: number;
  refreshToken?: string;
}

/**
 * Trade an OAuth `code` for a user access token.
 *
 * GitHub returns 200 even for invalid codes — the body contains an
 * `{ error, error_description }` object. The Zod parse fails for those,
 * raising a clear validation error.
 */
export async function exchangeUserCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  /** Must match the redirect_uri used to start the flow, if one was specified. */
  redirectUri?: string;
}): Promise<UserToken> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      ...(input.redirectUri && { redirect_uri: input.redirectUri }),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub token exchange failed: ${response.status} ${body}`);
  }

  const json = (await response.json()) as unknown;
  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `GitHub token exchange returned invalid response: ${JSON.stringify(json)}`,
    );
  }

  return {
    accessToken: parsed.data.access_token,
    expiresIn: parsed.data.expires_in,
    refreshToken: parsed.data.refresh_token,
  };
}
