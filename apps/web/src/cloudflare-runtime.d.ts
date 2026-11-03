/** Minimal types for the Workers runtime module used by optional bindings (e.g. SCOUT_KV). */
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
