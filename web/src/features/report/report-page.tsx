import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowUpRightIcon, FileTextIcon, PlusIcon } from "@phosphor-icons/react";
import { z } from "zod";
import { requestRecord, type CompensationReport, type CompensationRequest, type PayeeCompensationView } from "@multiagency/sdk/payee";
import { Button } from "../../components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../components/ui/card";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Empty, EmptyTitle, EmptyDescription } from "../../components/ui/empty";
import { Skeleton } from "../../components/ui/skeleton";
import { BASE, PayeeFailure } from "../../shared/client";
import { currentEpoch, useSession } from "../../app/session";
import { payeeCommands, payeeQueries } from "../../app/queries";
import { SignInCard } from "../../app/sign-in";
import { Labeled, ReportBody, ReportFields, RequestBadge, units, usdc, newIdentity } from "./compensation-ui";
import { AgentConnections } from "./agent-connections";

type View = PayeeCompensationView;
type Draft = { id: string; expectedVersion: number; amount: string; report: CompensationReport; attempt?: { commandId: string; fingerprint: string } };
const draftSchema = z.object({ id: z.uuid(), expectedVersion: z.number().int().nonnegative(), amount: z.string(), attempt: z.object({ commandId: z.uuid(), fingerprint: z.string() }).optional(), report: z.object({ agreementId: z.string(), amount: z.string().optional(), start: z.string(), end: z.string(), contributions: z.string(), assessment: z.string(), evidence: z.array(z.string()) }) });

/** Report work under a recorded agreement and follow review, approved compensation and payment. */
/** The report page's place: which agreement a new report starts from, and which request is open. */
export type ReportSearch = { agreement?: string; request?: string };
type Place = { search: ReportSearch; navigate: (search: ReportSearch) => void };

export function ReportPage(place: Place) {
  const session = useSession();
  return <div className="flex flex-col gap-8">
    {session.isPending ? <Skeleton className="h-48 w-full" />
      : !session.account ? <><Heading /><SignInCard title="Sign in as the contributor" description="Use the NEAR account named in your agreement. Signing in sends no payment." /></>
      : <Reports key={session.account} account={session.account} {...place} />}
  </div>;
}
/** The amount a request shows: only the owner's approved amount is compensation; a requested amount is a proposal. */
function amountLabel(request: CompensationRequest, pending: string) {
  if (request.approvedAmount) return `${usdc(request.approvedAmount)} USDC`;
  return request.report.amount ? `${usdc(request.report.amount)} USDC requested` : pending;
}
function Heading({ action }: { action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-5"><div className="max-w-2xl"><h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Report. Review. Receive.</h1><p className="mt-4 max-w-prose text-base leading-7 text-muted-foreground">Report your work and its impact. Follow the review, approved compensation and payment in one place.</p></div>{action}</div>;
}

/**
 * One account's reports. The draft and its command identity are saved before each command; a lost or
 * unreadable answer keeps both, so a retry resends the same command and Proto returns the original receipt.
 */
function Reports({ account, search, navigate }: { account: string } & Place) {
  const scope = `${location.origin}${BASE}:${account}`;
  const view = useQuery(payeeQueries.compensation(account));
  const [draft, setDraft] = useState<Draft | undefined>(() => {
    try { const saved = draftSchema.safeParse(JSON.parse(localStorage.getItem(`report:${scope}`) ?? "null")); return saved.success ? saved.data : undefined; } catch { return undefined; }
  });
  // The open request lives in the URL, so reload and back keep it; opening one adds a history entry.
  const selected = search.request, open = (request?: string) => navigate(request ? { request } : {});
  const [composingChoice, setComposing] = useState<boolean>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { if (draft) { try { localStorage.setItem(`report:${scope}`, JSON.stringify(draft)); } catch { setNotice("Draft storage unavailable. Keep this page open until your request is saved."); } } }, [draft]);
  async function run(work: () => Promise<void>) {
    const started = currentEpoch();
    setBusy(true); setError("");
    try { await work(); }
    catch (e) { const ended = e instanceof PayeeFailure && (e.failure.kind === "session" || e.failure.kind === "forbidden"); if (started === currentEpoch() && !ended) setError(e instanceof Error ? e.message : "Request unavailable."); }
    finally { if (started === currentEpoch()) setBusy(false); }
  }
  const records = view.data;
  // A link names its record or nothing: an unknown or unavailable agreement or request selects nothing, never another.
  const linked = records?.agreements.find(a => a.id === search.agreement);
  const unavailable = records && ((search.agreement && !linked) || (selected && !records.requests.some(r => r.id === selected)));
  // The terms a new report starts from: the linked agreement, or the first when no link names one.
  const startTerms = search.agreement ? linked : records?.agreements[0];
  // A draft on other terms than the link's: a blank one (nothing typed, never sent) gives way; one with content is kept,
  // and the page says so rather than showing it as the linked report.
  const blank = draft && draft.expectedVersion === 0 && !draft.attempt && !draft.amount && !draft.report.contributions.trim() && !draft.report.assessment.trim() && !draft.report.evidence.length;
  const otherDraft = linked && draft && draft.report.agreementId !== linked.id ? records?.agreements.find(a => a.id === draft.report.agreementId) ?? null : undefined;
  // Requests first when there are any; the form first when there are none, or when a link names the terms.
  const composing = composingChoice ?? Boolean(records && !selected && !(otherDraft !== undefined && !blank) && (linked || (!search.agreement && !records.requests.length)));
  useEffect(() => { if (records && composing && !selected && startTerms && (!draft || (otherDraft !== undefined && blank))) newRequest(); }, [records, composing, draft, selected, startTerms]);
  if (!records) return <><Heading />{view.error ? <Alert variant="destructive"><AlertDescription>{view.error.message}<Button variant="outline" disabled={view.isFetching} onClick={() => void view.refetch()}>Refresh records</Button></AlertDescription></Alert> : <Skeleton className="h-64 w-full" />}</>;
  const agreement = records.agreements.find(a => a.id === draft?.report.agreementId);
  const current = records.requests.find(r => r.id === selected);
  function newRequest(a = startTerms) {
    if (!a) return;
    setComposing(true); if (selected || (search.agreement && a.id !== search.agreement)) open(); setDraft({ id: newIdentity(), expectedVersion: 0, amount: "", report: { agreementId: a.id, start: a.terms.start, end: a.terms.end, contributions: "", assessment: "", evidence: [] } });
  }
  async function save(submit: boolean) {
    if (!draft) return;
    const started = currentEpoch();
    const input = { id: draft.id, expectedVersion: draft.expectedVersion, report: { ...draft.report, ...(draft.report.amount !== undefined && { amount: units(draft.amount) }), evidence: draft.report.evidence.map(s => s.trim()).filter(Boolean) }, submit };
    const fingerprint = JSON.stringify(input);
    const attempt = draft.attempt?.fingerprint === fingerprint ? draft.attempt : { commandId: newIdentity(), fingerprint };
    const retained = { ...draft, attempt };
    setDraft(retained);
    try { localStorage.setItem(`report:${scope}`, JSON.stringify(retained)); } catch { setNotice("Retry identity could not be saved locally. Read the existing request after any lost response."); }
    const result = await payeeCommands.submitReport({ ...input, commandId: attempt.commandId });
    if (started !== currentEpoch()) return;
    setDraft(undefined); localStorage.removeItem(`report:${scope}`); setComposing(false); open(result.id);
    setNotice(submit ? "Submitted for compensation review. Nothing has been sent for payment." : "Draft saved. It has not been submitted for review.");
    await view.refetch();
  }
  return <>
    <Heading action={<>{!draft && <Button disabled={busy || !records.agreements.length} onClick={() => newRequest(linked ?? records.agreements[0])}><PlusIcon data-icon="inline-start" />New report</Button>}{draft && !composing && <Button disabled={busy} onClick={() => { open(); setComposing(true); }}>Resume draft</Button>}</>} />
    {(error || view.error) && <Alert variant="destructive"><AlertDescription>{error || view.error?.message}<Button variant="outline" disabled={busy} onClick={() => run(async () => { await view.refetch(); })}>Refresh records</Button></AlertDescription></Alert>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {otherDraft !== undefined && !blank && !composingChoice && <Alert><AlertDescription>You have an unsent report on {otherDraft?.terms.title ?? "another agreement"}. Resume it and save or submit it, then open this link again to start a report on {linked!.terms.title}.</AlertDescription></Alert>}
    {unavailable && <Alert><AlertDescription>The {search.agreement && !linked ? "agreement" : "request"} in this link is not found or not available to this account. Nothing was selected.</AlertDescription></Alert>}
    {draft && composing ? <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card><CardHeader><CardTitle>Report your work</CardTitle><CardDescription>The owner reviews your evidence and sets compensation under your signed terms.</CardDescription></CardHeader><CardContent><form id="request-form" onSubmit={e => { e.preventDefault(); void run(() => save(true)); }}><div className="mb-7 flex flex-col gap-5"><Labeled id="submission-type" label="Submission type"><NativeSelect id="submission-type" value={draft.report.amount === undefined ? "report" : "invoice"} disabled={busy || draft.expectedVersion > 0} onChange={e => { const { amount: _amount, ...report } = draft.report; setDraft({ ...draft, report: { ...report, ...(e.target.value === "invoice" && { amount: "" }) } }); }}><NativeSelectOption value="report">Work report</NativeSelectOption><NativeSelectOption value="invoice">Invoice for an agreed amount</NativeSelectOption></NativeSelect></Labeled><Labeled id="agreement" label="Work agreement"><NativeSelect id="agreement" value={draft.report.agreementId} disabled={busy || draft.expectedVersion > 0} onChange={e => { const a = records.agreements.find(a => a.id === e.target.value)!; setDraft({ ...draft, report: { ...draft.report, agreementId: a.id, start: a.terms.start, end: a.terms.end } }); }}>{records.agreements.map(a => <NativeSelectOption key={a.id} value={a.id}>{a.terms.title}</NativeSelectOption>)}</NativeSelect></Labeled></div>
          <ReportFields report={draft.report} amount={draft.amount} onAmount={amount => setDraft({ ...draft, amount })} onChange={report => setDraft({ ...draft, report })} disabled={busy} />
        </form></CardContent><CardFooter className="flex-wrap justify-between gap-3"><Button variant="ghost" disabled={busy} onClick={() => { setComposing(false); open(); }}>Back to requests</Button><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={() => run(() => save(false))}>Save draft</Button><Button type="submit" form="request-form" disabled={busy}>{busy ? "Saving…" : draft.expectedVersion > 0 ? "Resubmit" : "Submit"}</Button></div></CardFooter></Card>
        <aside className="order-first flex flex-col gap-5 lg:order-last lg:sticky lg:top-8"><h2 className="text-lg font-semibold">Agreed boundaries</h2>{agreement && <><p className="break-words text-sm">{agreement.terms.title}</p><dl className="flex flex-col gap-4 text-sm"><div><dt className="text-muted-foreground">Remaining ceiling</dt><dd className="mt-1 text-3xl font-semibold tabular-nums">{usdc(agreement.remaining)} <span className="text-sm font-normal">USDC</span></dd></div><div><dt className="text-muted-foreground">Previously approved</dt><dd>{usdc(agreement.approved)} USDC</dd></div><div><dt className="text-muted-foreground">Work period</dt><dd>{agreement.terms.start} – {agreement.terms.end}</dd></div></dl><a className="text-sm underline" href={agreement.terms.document} rel="noreferrer" target="_blank">Signed agreement reference</a>{draft.report.amount !== undefined && units(draft.amount) && BigInt(units(draft.amount)) > BigInt(agreement.remaining) && <Alert><AlertDescription>Your request exceeds the remaining ceiling. It can be reviewed, but cannot be approved under these terms.</AlertDescription></Alert>}</>}<p className="border-t pt-4 text-sm leading-6 text-muted-foreground">The ceiling is a maximum, not guaranteed compensation. Review approval and payment completion are separate.</p></aside>
      </div> : current ? <div className="flex max-w-3xl flex-col gap-6"><Button variant="ghost" className="self-start" onClick={() => open()}><ArrowLeftIcon data-icon="inline-start" />All requests</Button><div className="flex flex-wrap items-baseline justify-between gap-4"><h2 className="text-3xl font-semibold tabular-nums">{amountLabel(current, "Compensation in review")}</h2><span className="text-xs text-muted-foreground">Revision {current.version}</span></div><ReportBody request={current} />
        {["draft", "changes_requested"].includes(current.state) && <Button className="self-start" disabled={!!draft} onClick={() => { setComposing(true); setDraft({ id: current.id, expectedVersion: current.version, amount: current.report.amount ? usdc(current.report.amount).replaceAll(",", "") : "", report: current.report }); open(); }}>Revise</Button>}
        <PaymentNotice request={current} view={records} /><details><summary className="flex min-h-11 cursor-pointer items-center text-sm">Submission history</summary><div className="flex flex-col gap-4 py-4">{records.history.filter(h => (h.record as { id?: string }).id === current.id).map(h => <div key={h.sequence} className="border-t pt-3"><ReportBody request={requestRecord.parse(h.record)} /></div>)}</div></details>
      </div> : <div className="flex flex-col gap-3"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Your requests</h2><Button variant="ghost" disabled={busy} onClick={() => run(async () => { await view.refetch(); })}>Refresh</Button></div>{!records.requests.length ? <Empty><FileTextIcon size={28} /><EmptyTitle>{records.agreements.length ? "Ready when your work is." : "An agreement comes first."}</EmptyTitle><EmptyDescription>{records.agreements.length ? "Submit your work report. The owner determines compensation under your signed terms." : "Ask the owner to record your signed agreement for this NEAR account."}</EmptyDescription></Empty> : records.requests.map(r => <button key={r.id} className="flex min-h-24 flex-wrap items-center justify-between gap-4 border-b px-1 py-5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { setComposing(false); open(r.id); setNotice(""); }}><span className="flex min-w-0 flex-col gap-2"><span className="font-medium">{records.agreements.find(a => a.id === r.report.agreementId)?.terms.title ?? "Work agreement"}</span><span className="text-sm text-muted-foreground">{r.report.start} – {r.report.end}</span></span><span className="flex flex-wrap items-center gap-5"><RequestBadge state={r.state} /><span className="tabular-nums font-semibold">{amountLabel(r, "Amount after review")}</span><ArrowUpRightIcon aria-hidden /></span></button>)}</div>}
    <AgentConnections account={account} />
  </>;
}
/**
 * What the contributor reads for each payment status Proto reports, and whether its outcome is unproven
 * (then the payment keeps its identity and must not be replaced). Approval is never shown as payment.
 */
const PAYMENT_WORDS: Record<string, [string, boolean]> = {
  preparing: ["Payment is being prepared. The owner still needs to authorize and fund it; nothing has been sent.", false],
  preparation_incomplete: ["Payment preparation is incomplete. The owner needs to reopen it; nothing has been sent.", false],
  expired: ["The payment deadline passed before an invoice was filed. Ask the owner how to proceed.", false],
  prepared: ["The payment is recorded but not yet submitted. It keeps its original identity.", false],
  busy: ["The payment cannot be submitted right now. Nothing new was sent; check again later.", false],
  waiting: ["Waiting for the owner to approve the payout. Approval is not payment.", false],
  paying: ["Approved. The payment is processing; settlement is not yet confirmed.", false],
  paid: ["Paid.", false],
  refused: ["Refused: nothing was sent for this payment. Ask the owner to review the refusal.", false],
  unavailable: ["Payment status is unavailable right now. Refresh before acting.", false],
  unknown: ["The payment outcome is unknown and needs reconciliation. Do not submit a replacement request.", true],
  needs_review: ["This payment needs review; an existing payment may still be pending. Do not submit a replacement request.", true],
  failed: ["The provider reported a failed or refunded outcome. That alone does not make a replacement safe; ask the owner to review it.", true],
};
function PaymentNotice({ request, view }: { request: CompensationRequest; view: View }) {
  const id = request.payment?.id;
  if (!id) return <p className="border-t pt-5 text-sm text-muted-foreground">{request.state === "approved" ? "Compensation approved. Payment has not been prepared." : "Nothing submitted for payment."}</p>;
  const status = view.payments.find(p => p.requestId === request.id)?.status ?? (request.payment?.mode === "isolated" ? "preparation_incomplete" : "unavailable");
  const [text, unresolved] = PAYMENT_WORDS[status] ?? [`Payment status: ${status.replaceAll("_", " ")}.`, true];
  return <Alert variant={unresolved ? "warning" : "default"}><AlertDescription><span>{text}</span><a href={`${BASE}/`} className="underline">Your payouts</a></AlertDescription></Alert>;
}
