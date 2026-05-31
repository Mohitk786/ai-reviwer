/**
 * GitHub webhook signature verification.
 *
 * GitHub signs every webhook delivery with HMAC-SHA256 using the app's webhook
 * secret and sends the digest in the `X-Hub-Signature-256` header.
 *
 * Rules:
 *   - MUST be called with the raw request body bytes, BEFORE JSON parsing.
 *   - MUST use `timingSafeEqual` to prevent timing-based secret extraction.
 *   - Any error (bad hex, wrong prefix, missing header) returns `false` — never throws.
 *
 * Usage:
 *   ```ts
 *   const rawBody = await request.text();
 *   const sig = request.headers.get('x-hub-signature-256');
 *   if (!verifyGithubSignature(rawBody, sig, secret)) {
 *     return new Response('Unauthorized', { status: 401 });
 *   }
 *   const payload = JSON.parse(rawBody);
 *   ```
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith(SIGNATURE_PREFIX)) return false;

  const incomingHex = signatureHeader.slice(SIGNATURE_PREFIX.length);

  // Reject obviously malformed signatures before computing HMAC.
  if (incomingHex.length === 0 || incomingHex.length % 2 !== 0) return false;

  const expectedHex = createHmac('sha256', secret)
    .update(Buffer.from(rawBody))
    .digest('hex');

  try {
    // timingSafeEqual throws if buffer lengths differ — catch it and return false.
    return timingSafeEqual(
      Buffer.from(incomingHex, 'hex'),
      Buffer.from(expectedHex, 'hex'),
    );
  } catch {
    return false;
  }
}
