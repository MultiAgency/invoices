import type { Agreement, Invoice } from "@multiagency/sdk/payee";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { BASE, LOST, PayeeFailure } from "../../shared/client";
import { currentEpoch } from "../../app/session";
import { payeeCommands, payeeQueries } from "../../app/queries";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { AGREEMENT_WORDS, decimal, OPEN, REVIEW, usdc, when, WORDS } from "./words";

/** Statuses that settle a submitted form: its draft and identity are no longer needed. */
const SETTLED = new Set(["waiting", "paying", "paid", "refused", "requested", "proposed"]);
const accessEnded = (error: unknown) => error instanceof PayeeFailure && (error.failure.kind === "session" || error.failure.kind === "forbidden");

function Row({ title, status, tone, at, label = "", children }: { title: string; status: string; tone: string; at: string; label?: string; children?: React.ReactNode }) {
  return <li className="flex flex-col gap-1.5 border-t py-3 first:border-t-0 first:pt-0">
    <div>{title}</div>
    <span className={"chip self-start rounded-full px-2.5 py-0.5 text-xs font-medium " + (tone === "ok" ? "bg-success-muted text-success-muted-foreground" : tone === "warn" ? "bg-warning-muted text-warning-muted-foreground" : "bg-muted text-muted-foreground")}>{status}</span>
    <span className="text-xs text-muted-foreground">{label}{when(at)}</span>
    {children}
  </li>;
}

/**
 * Request a payout and follow it: one submission identity per filled-in form, kept with the draft until Proto
 * returns a record that settles it. While anything can still change, the list checks again every 15 seconds.
 */
export function Payouts({ account, sessionAgreed }: { account: string; sessionAgreed: boolean }) {
  const draftKey = `invoice-draft:${BASE ? BASE + ":" : ""}${account}`;
  const readDraft = () => { try { return JSON.parse(localStorage.getItem(draftKey) ?? "null"); } catch { return null; } };
  const saved = readDraft();
  const [submission, setSubmission] = useState<string>(saved?.submission ?? crypto.randomUUID());
  const [amount, setAmount] = useState<string>(saved?.amount ?? ""), [note, setNote] = useState<string>(saved?.note ?? "");
  const [retained, setRetained] = useState(Boolean(saved?.submission));
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null), refreshRef = useRef<HTMLButtonElement>(null), lastFocused = useRef<Element | null>(null);
  const invoices = useQuery({ ...payeeQueries.invoices(account),
    refetchInterval: query => query.state.status === "error" || query.state.data?.invoices.some(i => OPEN.has(i.status))
      || query.state.data?.agreements.some(a => a.status === "requested" || a.status === "proposed") ? 15_000 : false });
  const agreed = invoices.data?.agreed ?? sessionAgreed;
  // Polling keeps controls (and their focus); when a focused control's row loses it, focus moves to the refresh button.
  useLayoutEffect(() => {
    if (lastFocused.current && !lastFocused.current.isConnected && (document.activeElement === document.body || !document.activeElement)) refreshRef.current?.focus();
    if (lastFocused.current && !lastFocused.current.isConnected) lastFocused.current = null;
  });
  const track = (event: React.FocusEvent) => { lastFocused.current = event.target; };

  function clearForm() { localStorage.removeItem(draftKey); setRetained(false); setSubmission(crypto.randomUUID()); setAmount(""); setNote(""); }
  async function submitInvoice(input: { amount: string; note: string; submission: string }, saveDraft: boolean) {
    const started = currentEpoch();
    setError("");
    if (saveDraft) { localStorage.setItem(draftKey, JSON.stringify(input)); setRetained(true); }
    try {
      const result = await payeeCommands.submitInvoice(input);
      if (started !== currentEpoch()) return;
      const conflict = "revisionConflict" in result && result.revisionConflict;
      if (saveDraft && SETTLED.has(result.status) && !conflict) clearForm();
      if (result.status === "needs_agreement" || result.status === "busy" || ["unknown", "prepared", "needs_review", "failed", "refused"].includes(result.status))
        setError(WORDS[result.status]?.[0] ?? result.status);
      await invoices.refetch();
    } catch (failure) {
      // The draft and its identity stay saved: only a record Proto returned settles this form. A definitive refusal
      // is marked, so changed terms can go out under a new identity (nothing was recorded under the refused one).
      if (saveDraft && failure instanceof PayeeFailure && failure.failure.kind === "refused") localStorage.setItem(draftKey, JSON.stringify({ ...input, refused: true }));
      if (started === currentEpoch() && !accessEnded(failure)) setError(failure instanceof Error ? failure.message : LOST);
    }
  }
  /**
   * The identity to send: the retained one, except after a definitive refusal when the contributor changed the
   * terms. An unchanged retry, and every unknown, session or forbidden outcome, keeps the original identity.
   */
  function identityFor(terms: { amount: string; note: string }) {
    const draft = readDraft();
    if (!draft?.refused || draft.submission !== submission || (draft.amount === terms.amount && draft.note === terms.note)) return submission;
    const fresh = crypto.randomUUID();
    setSubmission(fresh);
    return fresh;
  }
  async function submit() {
    const started = currentEpoch();
    setSubmitting(true);
    try { await submitInvoice({ amount, note, submission: identityFor({ amount, note }) }, true); }
    finally { if (started === currentEpoch()) setSubmitting(false); }
  }
  async function continueInvoice(invoice: Invoice) {
    const started = currentEpoch();
    setError("");
    try {
      const result = await payeeCommands.continueInvoice(invoice.id);
      if (started === currentEpoch() && WORDS[result.status]) setError(WORDS[result.status]![0]);
    } catch (failure) { if (started === currentEpoch() && !accessEnded(failure)) setError(failure instanceof Error ? failure.message : LOST); }
    if (started === currentEpoch()) await invoices.refetch();
  }
  function applyTerms(agreement: Agreement) {
    if (!agreement.terms) { setError("Agreement terms are unavailable. Refresh before filing."); return; }
    setAmount(decimal(agreement.terms.maxAmount)); setNote(agreement.note); setSubmission(crypto.randomUUID()); setRetained(false);
    amountRef.current?.focus();
  }
  function fileAgreement(agreement: Agreement) {
    if (!agreement.submission) { setError("This request has no retained identity. Refresh before filing."); return; }
    void submitInvoice({ amount: decimal(agreement.amount), note: agreement.note, submission: agreement.submission }, false);
  }

  const agreements = invoices.data?.agreements ?? [], list = invoices.data?.invoices ?? [];
  return <>
    <section id="step-invoice" className="flex flex-col gap-4 rounded-xl border bg-card p-6" onFocus={track}>
      <h2 className="text-lg font-semibold">Request a payout</h2>
      <span id="agreed-chip" className={"chip self-start rounded-full px-2.5 py-0.5 text-xs font-medium " + (agreed ? "ok bg-success-muted text-success-muted-foreground" : "warn bg-warning-muted text-warning-muted-foreground")}>{agreed ? "Agreed payee" : "Not agreed yet"}</span>
      {!agreed && <p id="not-agreed" className="rounded-lg bg-warning-muted px-4 py-3 text-sm text-warning-muted-foreground">The DAO hasn't agreed to pay this account yet. Submitting sends it a request; you're paid only after it agrees and you file the invoice.</p>}
      {agreements.length > 0 && <section id="agreements-card" className="flex flex-col gap-2"><h2 className="font-semibold">Your agreements</h2><ul id="agreements" className="flex flex-col">
        {agreements.map(agreement => {
          const terms = agreement.terms ? "up to " + usdc(agreement.terms.maxAmount) + " until " + new Date(agreement.terms.until).toLocaleDateString() : usdc(agreement.amount);
          const title = [agreement.origin === "owner" ? "Offered by the DAO" : "Requested", terms, agreement.note].filter(Boolean).join(" · ");
          return <Row key={agreement.id} title={title} status={AGREEMENT_WORDS[agreement.status] ?? agreement.status} at={agreement.at}
            tone={agreement.status === "declined" ? "warn" : agreement.status === "agreed" ? "ok" : ""}>
            {agreement.status === "agreed" && <Button variant="outline" size="sm" className="self-start" onClick={() => agreement.origin === "owner" ? applyTerms(agreement) : fileAgreement(agreement)}>
              {agreement.origin === "owner" ? "Use these terms" : "File this invoice"}</Button>}
          </Row>;
        })}
      </ul></section>}
      <div className="flex flex-col gap-2"><Label htmlFor="amount">Amount (USDC)</Label><Input id="amount" ref={amountRef} inputMode="decimal" autoComplete="off" placeholder="250" value={amount} onChange={e => setAmount(e.target.value)} /></div>
      <div className="flex flex-col gap-2"><Label htmlFor="note">What's it for? (optional)</Label><Input id="note" maxLength={200} autoComplete="off" placeholder="October design work" value={note} onChange={e => setNote(e.target.value)} /></div>
      {/* Local draft identity is not payment evidence: keep that limitation beside the action after reload. */}
      {retained && <p id="retained-draft" role="status" className="rounded-lg bg-warning-muted px-4 py-3 text-sm text-warning-muted-foreground">This form retains a previous submission. Check its existing invoice and payment outcome before submitting again. Do not create a replacement while its outcome is unknown.</p>}
      {/* Filing waits for the API to confirm the payout is held, which can take half a minute. */}
      <Button id="submit" className="self-start" disabled={submitting} onClick={submit}>{submitting ? "Submitting… this can take up to a minute" : agreed ? "Submit invoice" : "Send request"}</Button>
    </section>
    {error && <p id="error" role="alert" className="rounded-lg bg-warning-muted px-4 py-3 text-sm text-warning-muted-foreground">{error}</p>}
    <div className="flex flex-col gap-2">
      <p id="refresh-status" className="text-sm text-muted-foreground">{invoices.data ? "Last checked " + new Date(invoices.dataUpdatedAt).toLocaleTimeString() : ""}</p>
      <p id="refresh-error" role="alert" className="text-sm">{invoices.isError ? invoices.error.message : ""}</p>
      <Button id="refresh" ref={refreshRef} variant="outline" className="self-start" onClick={() => void invoices.refetch()}>Check invoice status again</Button>
    </div>
    <section id="list" className="flex flex-col gap-3 rounded-xl border bg-card p-6" onFocus={track}>
      <h2 className="text-lg font-semibold">Your payouts</h2>
      <ul id="invoices" className="flex flex-col">
        {list.map(invoice => {
          const [text, tone] = WORDS[invoice.status] ?? [invoice.status, ""];
          return <Row key={invoice.id} title={[usdc(invoice.amount), invoice.note].filter(Boolean).join(" · ")} at={invoice.filedAt} tone={tone}
            status={text + (invoice.revisionConflict ? " Changed invoice details require review; the original payment is unchanged." : "")}>
            {invoice.status === "prepared" && !invoice.revisionConflict && <ContinueButton onContinue={() => continueInvoice(invoice)} />}
            {(invoice.revisionConflict || REVIEW.has(invoice.status)) && <>
              <p className="text-sm">Share this reference privately with the treasury operator for review: {invoice.id}</p>
              <CopyButton text={"Invoice " + invoice.id + " · " + invoice.status} onFail={() => setError("Copy the reference above and send it to the treasury operator.")} />
            </>}
          </Row>;
        })}
      </ul>
      {invoices.isSuccess && list.length === 0 && <p id="none" className="text-sm text-muted-foreground">No payouts requested yet. Request a payout above, or file against an authorized work order.</p>}
    </section>
  </>;
}

function ContinueButton({ onContinue }: { onContinue: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <Button variant="outline" size="sm" className="self-start" disabled={busy} onClick={async () => { setBusy(true); try { await onContinue(); } finally { setBusy(false); } }}>Continue this prepared invoice</Button>;
}
function CopyButton({ text, onFail }: { text: string; onFail: () => void }) {
  const [copied, setCopied] = useState(false);
  return <Button variant="outline" size="sm" className="self-start" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { onFail(); } }}>{copied ? "Copied" : "Copy review reference"}</Button>;
}
