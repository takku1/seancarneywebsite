/** RFC 9116 security contact. Regenerated each build so "Expires" stays under a year out. */
import type { APIRoute } from 'astro';
import { site } from '../../config/site';

export const GET: APIRoute = ({ site: origin }) => {
  const expires = new Date(Date.now() + 180 * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const body = [
    `Contact: mailto:${site.email.management}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en',
    `Canonical: ${new URL('/.well-known/security.txt', origin).href}`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
