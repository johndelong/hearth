import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { deleteRaw, getRaw, setRaw } from './store/settings.js';

const COOKIE = 'parent_session';
const SESSION_MS = 30 * 60_000; // a wall panel should not stay unlocked all day

/** In-memory sessions: a restart re-locks Settings, which is the safe default. */
const sessions = new Map<string, number>();

function hash(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString('hex');
}

export function setPin(pin: string): void {
  const salt = randomBytes(16).toString('hex');
  setRaw('_pinHash', `${salt}:${hash(pin, salt)}`);
}

export function clearPin(): void {
  deleteRaw('_pinHash');
  sessions.clear();
}

export function pinIsSet(): boolean {
  return Boolean(getRaw('_pinHash'));
}

export function verifyPin(pin: string): boolean {
  const stored = getRaw('_pinHash');
  if (!stored) return true; // no PIN configured yet — nothing to check against
  const [salt, expected] = stored.split(':');
  if (!salt || !expected || !/^[0-9a-f]{64}$/.test(expected)) return false;
  const actual = hash(pin, salt);
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startSession(reply: FastifyReply): void {
  const token = randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    signed: true,
    secure: process.env.PUBLIC_URL?.startsWith('https://') ?? false,
    sameSite: 'lax',
    maxAge: SESSION_MS / 1000,
  });
}

export function endSession(request: FastifyRequest, reply: FastifyReply): void {
  const token = sessionToken(request);
  if (token) sessions.delete(token);
  reply.clearCookie(COOKIE, { path: '/' });
}

export function hasSession(request: FastifyRequest): boolean {
  if (!pinIsSet()) return true; // unconfigured PIN leaves the panel open
  const token = sessionToken(request);
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  sessions.set(token, Date.now() + SESSION_MS); // sliding window while in use
  return true;
}

function sessionToken(request: FastifyRequest): string | null {
  const raw = request.cookies[COOKIE];
  if (!raw) return null;
  const parsed = request.unsignCookie(raw);
  return parsed.valid ? parsed.value : null;
}

/**
 * Guard for parent-only mutations. Kids can check chores off; changing who owns
 * what, the points, or the calendars requires the PIN.
 */
export async function requireParent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (hasSession(request)) return;
  await reply.code(401).send({ error: 'PIN required' });
}
