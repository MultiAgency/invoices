import { payeeClient, type Failure, type Result } from "@multiagency/sdk/payee";

/** The payee instance this page serves: the agency's root intake, or one owner's scoped entry. */
export const BASE = location.pathname.match(/^\/i\/own-[0-9a-f]{24}(?=\/|$)/)?.[0] ?? "";

/**
 * Proto's platform client. Same-origin, never retries, never mints an identity: a lost, failed (5xx) or
 * unreadable answer to a submission is `unknown`, and the page keeps that identity for observation.
 */
export const client = payeeClient({ base: BASE });

export const LOST = "The response was lost or unreadable, so the outcome is unknown. This form keeps its original submission identity; check your existing records before trying again, and do not create a replacement.";
export const ACCESS_ENDED = {
  session: "Your session expired. Sign in again to review your existing records. Your retained submission identity has not changed.",
  forbidden: "This account may not access these records here. Sign in with the account that receives the payment. Your retained submission identity has not changed.",
} as const;

/** A failed payee call, carried through queries and mutations as an error. */
export class PayeeFailure extends Error {
  constructor(readonly failure: Failure, message: string) { super(message); }
}

/** The value of a successful call, or a PayeeFailure saying what is safe next (`unavailable` for a failed read). */
export function settle<T>(result: Result<T>, unavailable: string): T {
  if (result.ok) return result.value;
  const message = result.kind === "session" || result.kind === "forbidden" ? ACCESS_ENDED[result.kind]
    : result.kind === "refused" ? result.error : result.kind === "unknown" ? LOST : unavailable;
  throw new PayeeFailure(result, message);
}
