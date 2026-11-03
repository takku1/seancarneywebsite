/** Single authentication gate for privileged API routes (used by src/middleware.ts). */
import { SCOUT_ADMIN_TOKEN } from 'astro:env/server';

/** Constant-time string compare (ASVS 11.2.4). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the request carries `authorization: Bearer <SCOUT_ADMIN_TOKEN>`. Fails closed if unset. */
export function requireAuth(request: Request): boolean {
  const auth = request.headers.get('authorization') ?? '';
  return !!SCOUT_ADMIN_TOKEN && safeEqual(auth, `Bearer ${SCOUT_ADMIN_TOKEN}`);
}
