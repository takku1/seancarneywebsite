/** Request-size guard (OWASP API4), shared by src/middleware.ts. */
/** True once a body without Content-Length passes `max` bytes. Reads a clone, so the handler still gets the body. */
export async function exceeds(req: Request, max: number): Promise<boolean> {
  if (!req.body) return false;
  const reader = req.clone().body!.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return false;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return true;
    }
  }
}
