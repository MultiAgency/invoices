import { payeeWorkOrderRequest } from "@multiagency/sdk/payee";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BASE, PayeeFailure } from "../../shared/client";
import { currentEpoch, queryClient } from "../../app/session";
import { payeeCommands, payeeQueries } from "../../app/queries";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { usdc, when, WORDS } from "./words";

const wordsFor = (status: string) => WORDS[status]?.[0] ?? status;

/** Propose a work order. Saving a request records terms for the owner's review; it moves no funds. */
export function RequestWork({ account, onRequested }: { account: string; onRequested: () => void }) {
  const key = `work-order-draft:${BASE}:${account}`;
  const saved = (() => { try { return { draft: JSON.parse(localStorage.getItem(key) ?? "null"), unreadable: false }; } catch { return { draft: null, unreadable: true }; } })();
  const [submission, setSubmission] = useState<string>(saved.draft?.submission ?? crypto.randomUUID());
  const [note, setNote] = useState<string>(saved.draft?.note ?? ""), [amount, setAmount] = useState<string>(saved.draft?.amount ?? ""), [date, setDate] = useState<string>(saved.draft?.date ?? "");
  const [message, setMessage] = useState(saved.unreadable ? "The saved draft could not be read. Check your work orders before making another request."
    : saved.draft ? "A previous request is retained. Check your work orders before retrying; keep its original terms if the outcome is unknown." : "");
  const [sending, setSending] = useState(false);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    const draft = { submission, note, amount, date, until: date + "T23:59:59.999Z" };
    const { date: _date, ...fields } = draft;
    // Terms the contract would refuse are corrected here, before anything is saved or sent.
    const request = payeeWorkOrderRequest.safeParse(fields);
    if (!request.success) { setMessage("Check the work description, amount and deadline. Nothing was sent."); return; }
    const started = currentEpoch();
    setSending(true);
    try {
      localStorage.setItem(key, JSON.stringify(draft));
      const result = await payeeCommands.requestWorkOrder(request.data);
      if (started !== currentEpoch()) return;
      localStorage.removeItem(key);
      setSubmission(crypto.randomUUID()); setNote(""); setAmount(""); setDate("");
      setMessage("Work order requested. The owner must review and authorize it before any payout. Reference: " + result.id);
      onRequested();
      void queryClient.invalidateQueries({ queryKey: payeeQueries.workOrders(account).queryKey });
    } catch (error) {
      if (started === currentEpoch() && error instanceof PayeeFailure && error.failure.kind !== "session" && error.failure.kind !== "forbidden")
        setMessage(error.message + " Your draft is retained. Check your work orders before changing its terms or starting another request.");
    } finally { if (started === currentEpoch()) setSending(false); }
  }
  return <section id="request-work" aria-labelledby="request-work-title" className="flex flex-col gap-4 rounded-xl border bg-card p-6">
    <h2 id="request-work-title" className="text-lg font-semibold">Request a work order</h2>
    <p className="text-sm text-muted-foreground">Propose the work, a fixed USDC amount and a deadline. The owner reviews these terms and signs the authorization before you can request payment. Saving a request moves no funds. Requesting terms doesn't make you a payee; a signed agreement does.</p>
    <form id="work-request-form" onSubmit={send} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2"><Label htmlFor="work-request-note">Describe the work</Label><Input id="work-request-note" required maxLength={200} autoComplete="off" placeholder="Design and deliver the contributor guide" value={note} onChange={e => setNote(e.target.value)} /></div>
        <div className="flex flex-col gap-2"><Label htmlFor="work-request-amount">Work order total (USDC)</Label><Input id="work-request-amount" required inputMode="decimal" autoComplete="off" placeholder="250" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div className="flex flex-col gap-2"><Label htmlFor="work-request-until">Deadline (UTC)</Label><Input id="work-request-until" required type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      </div>
      <p id="work-request-message" role="status" className="text-sm">{message}</p>
      <Button id="work-request-submit" type="submit" className="self-start" disabled={sending}>{sending ? "Sending request…" : "Send work order request"}</Button>
    </form>
  </section>;
}

/** Review proposed terms and authorization, and file the fixed-term invoice of a funded work order. */
export function WorkOrders({ account, checked, onCheck, initial }: { account: string; checked: boolean; onCheck: () => void; initial?: string }) {
  const [selected, setSelected] = useState<string | undefined>(initial);
  const [filing, setFiling] = useState(false), [filingStatus, setFilingStatus] = useState(""), [filingError, setFilingError] = useState("");
  const list = useQuery({ ...payeeQueries.workOrders(account), enabled: checked });
  const detail = useQuery({ ...payeeQueries.workOrder(account, selected ?? ""), enabled: Boolean(selected), refetchInterval: 15_000 });
  useEffect(() => { if (detail.dataUpdatedAt) setFilingStatus(""); }, [detail.dataUpdatedAt]);
  const order = detail.data;
  async function file() {
    if (!order?.ready || filing) return;
    if (!confirm("File " + usdc(order.amount) + " for " + order.note + "? This uses the work order's fixed terms and requires owner approval.")) return;
    const started = currentEpoch();
    setFiling(true); setFilingError("");
    setFilingStatus("Waiting for the provider. Keep this work order open to follow its existing payment.");
    try {
      const result = await payeeCommands.fileWorkOrder(order.id);
      if (started === currentEpoch()) setFilingStatus(wordsFor(result.status));
    } catch (error) {
      // The order has exactly one invoice identity: following it is safe; a replacement filing is impossible.
      if (started === currentEpoch() && error instanceof PayeeFailure && error.failure.kind !== "session" && error.failure.kind !== "forbidden")
        setFilingError(error.failure.kind === "unknown" ? "The filing outcome is unknown. Keep this work order open to follow its existing payment." : error.message);
    } finally {
      if (started === currentEpoch()) { setFiling(false); void queryClient.invalidateQueries({ queryKey: payeeQueries.workOrder(account, order.id).queryKey }); }
    }
  }
  const status = filingStatus || (!order ? "" : order.unavailable ? "Status unavailable. Refresh this work order before acting."
    : order.invoice ? wordsFor(order.invoice.status)
    : Date.parse(order.until) <= Date.now() ? "The work order deadline has passed."
    : order.ready ? "Ready to file. The payment will be held for owner approval." : "Waiting for owner authorization or funding.");
  const error = filingError || detail.error?.message || list.error?.message || (list.data && list.data.orders.length === 0 ? "No work orders for this signed-in account." : "");
  return <section id="work-orders-card" aria-labelledby="work-orders-title" className="flex flex-col gap-4 rounded-xl border bg-card p-6">
    <h2 id="work-orders-title" className="text-lg font-semibold">Your work orders</h2>
    <p className="text-sm text-muted-foreground">Review proposed terms and authorization, then request a payout from a funded work order. Each payment still needs the owner's approval.</p>
    <Button id="work-orders-check" variant="outline" className="self-start" onClick={() => { onCheck(); void list.refetch(); if (selected) void detail.refetch(); }}>Check work orders</Button>
    <ul id="work-orders-list" className="flex flex-col divide-y">
      {list.data?.orders.map(o => <li key={o.id} className="flex flex-col gap-1.5 py-3">
        <div>{o.note}</div><span className="self-start rounded-full bg-muted px-2.5 py-0.5 text-xs">{usdc(o.amount)}</span>
        <span className="text-xs text-muted-foreground">Deadline: {when(o.until)}</span>
        <Button variant="outline" size="sm" className="self-start" onClick={() => { if (!filing) setSelected(o.id); }}>Review work order</Button>
      </li>)}
    </ul>
    {order && <div id="work-order-detail" className="flex flex-col gap-2 border-t pt-4">
      <h3 id="work-order-note" className="font-semibold">{order.note}</h3>
      <p id="work-order-terms" className="text-sm">{usdc(order.amount)} · {account} · deadline {when(order.until)}</p>
      <p id="work-order-status" role="status" className="text-sm">{status}</p>
      <Button id="work-order-file" className="self-start" disabled={!order.ready || filing} onClick={file}>
        {filing ? "Filing work order invoice…" : order.invoice?.status === "prepared" ? "Continue work order invoice" : "File work order invoice"}</Button>
    </div>}
    <p id="work-order-error" role="alert" className="text-sm">{error}</p>
  </section>;
}
