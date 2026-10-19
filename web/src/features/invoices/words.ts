/** What the page says for each invoice status, and its tone. */
export const WORDS: Record<string, [string, "" | "ok" | "warn"]> = {
  needs_agreement: ["This account isn't on the agreed list. A new agreement has to be approved first.", "warn"],
  refused: ["Refused: nothing was sent for this invoice. Ask the operator to review the refusal before trying another payment.", "warn"],
  busy: ["This invoice cannot be submitted right now. Keep this draft and try again later, or ask the operator to check what is blocking it.", "warn"],
  waiting: ["Waiting for approval. The treasury has 24 hours to approve it.", ""],
  paying: ["The payment is processing. Settlement is not yet confirmed.", ""],
  prepared: ["Recorded, never submitted. Continue this invoice with its original terms and payment identity.", ""],
  unknown: ["The payment outcome is unknown. It needs reconciliation; do not create a replacement invoice.", "warn"],
  needs_review: ["This invoice needs review. An existing payment may still be pending; do not file it again as a new invoice.", "warn"],
  paid: ["Paid.", "ok"],
  failed: ["The provider reported a failed or refunded outcome. This alone does not establish that a replacement payment is safe; ask the operator to review it.", "warn"],
};

/** What the page says for each agreement status; a filed one shows as its invoice instead. */
export const AGREEMENT_WORDS: Record<string, string> = {
  requested: "Waiting for the DAO to agree to pay you. Nothing is paid until it does and you file the invoice.",
  proposed: "The terms are saved; the DAO still needs to approve the policy before you can file.",
  agreed: "Agreed. File the invoice to be paid.",
  declined: "The DAO declined this request.",
};

/** Invoice statuses whose outcome can still change, so the page keeps checking them. */
export const OPEN = new Set(["waiting", "paying", "unknown", "needs_review"]);
/** Invoice statuses whose outcome is unproven or refused: the payee gets a review reference. */
export const REVIEW = new Set(["unknown", "needs_review", "failed", "refused"]);

export const usdc = (raw: string | null) => raw === null ? "" : (Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 }) + " USDC";
export const decimal = (raw: string) => String(Number(raw) / 1e6);
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
