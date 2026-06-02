
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';


const SESSION_COOKIE = 'rag_session';
const STATE_COOKIE = 'rag_oauth_state';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const STATE_TTL_SECONDS = 60 * 10; // 10 minutes


export interface SessionPayload {
  userId: string;
  exp: number;
}


function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/** Build the cookie value. Public so tests can construct fixtures. */
export function createSessionToken(userId: string, secret: string): string {
  const payload: SessionPayload = {
    userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(b64, secret);
  return `${b64}.${sig}`;
}

/**
 * Parse + verify a session token. Returns null on:
 *   - Malformed structure.
 *   - Bad signature (constant-time compared via `timingSafeEqual`).
 *   - Expired payload.
 *   - JSON parse failure.
 */
export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(b64, secret);
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8')) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/** Issue a new session cookie. Called from the callback route on successful sign-in. */
export async function setSession(userId: string, secret: string): Promise<void> {
const token = createSessionToken(userId, secret);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Read the session from request cookies. Returns null when not signed in. */
export async function getSession(secret: string): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token, secret);
}

/** Clear the session cookie. Called from /api/auth/signout. */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}


export function generateState(): string {
  return randomBytes(32).toString('hex');
}

/** Store the state in an httpOnly cookie. Called on /api/auth/github/start. */
export async function setStateCookie(state: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_SECONDS,
  });
}

/**
 * Read the state cookie and immediately delete it (single-use). Returns the
 * stored state, or null if missing / expired.
 *
 * Single-use prevents replay attacks: even if an attacker captures a state
 * from a previous flow, it can't be re-used after the legitimate callback
 * consumes it.
 */
export async function consumeStateCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const state = cookieStore.get(STATE_COOKIE)?.value ?? null;
  if (state) {
    cookieStore.delete(STATE_COOKIE);
  }
  return state;
}


export function statesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;

  //time safe equal prevent timing attack here : NEW LEARNING
  return timingSafeEqual(ba, bb);
}
