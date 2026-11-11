/**
 * Log-safe error codes (ASVS 16.2.5, OWASP A09).
 *
 * Exception messages from fetch, D1 and third-party SDKs can carry URLs (a
 * GoHighLevel webhook URL is itself a secret), request parameters or personal
 * data. Logs therefore never contain a raw message: only a code from the
 * allowlist below (messages this app throws itself), or the error's class.
 */
const CODE = /^(ghl_\/[\w/.-]{1,80}_\d{3}|webhook_\d{3}|resend_\d{3}|lease_lost|partial|timeout|network|error|[A-Z][A-Za-z]{0,39}Error)$/;

/** A stable, log-safe code for any thrown value. Compound codes join with '+'. */
export function errorCode(e: unknown): string {
  if (!(e instanceof Error)) return 'non_error_thrown';
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'timeout';
  const msg = e.message ?? '';
  if (msg && msg.split('+').every((part) => CODE.test(part))) return msg;
  if (e.name === 'TypeError' && /fetch|network/i.test(msg)) return 'network';
  // Only the class name: it is code-defined, never data.
  return /^[A-Za-z]{1,40}$/.test(e.name) && e.name !== 'Error' ? e.name : 'error';
}
