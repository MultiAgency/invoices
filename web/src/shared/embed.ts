/**
 * The API base an embedding host gives the app. The host serves (or proxies) the payee routes on **its own origin**, so the
 * value is a path on that origin and nothing else: no scheme, host or `..`. This keeps the rule that cookies and
 * authorization headers are never sent across origins: the app can only call same-origin paths.
 */
const SAME_ORIGIN_PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/;

/** The base path, "" for the host's root, or null when the value is not a plain same-origin path. */
export function embeddedBase(value: unknown): string | null {
  if (typeof value !== "string" || !SAME_ORIGIN_PATH.test(value)) return null;
  return value === "/" ? "" : value;
}

/** The global the remote sets before the app's modules load; read once by the client. */
export const EMBED_BASE_KEY = "__INVOICES_API_BASE__";
