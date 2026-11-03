import type { APIRoute } from 'astro';

/** AI assistants are explicitly allowed: they are a growing discovery channel for event buyers. */
export const GET: APIRoute = ({ site }) =>
  new Response(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /inquire/thanks',
      '',
      `Sitemap: ${new URL('sitemap-index.xml', site).href}`,
      '',
    ].join('\n'),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
