import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { agentConnectionIssue, PAYEE_REPORT_PERMISSIONS, type AgentConnection } from "@multiagency/sdk/payee";
import { currentEpoch, queryClient } from "../../app/session";
import { payeeCommands, payeeQueries } from "../../app/queries";
import { PayeeFailure } from "../../shared/client";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";

/** What each permission a connection carries lets the agent do, in the contributor's words. */
const CAN: Record<string, string> = {
  "compensation.read": "Read your reports, the owner's feedback and their payment status",
  "compensation.submit": "Submit and revise your contribution reports",
};
/** What no agent connection can do; the platform refuses these whatever the agent sends. */
const CANNOT = [
  "File invoices or work orders, or request payouts",
  "Approve, prepare or pay anything",
  "See other contributors' records",
  "Reach another entry, another host, or the owner's workspace",
  "Sign in as you in a browser, or start or revoke connections",
];
const DURATIONS = [["900", "15 minutes"], ["3600", "1 hour"], ["28800", "8 hours"], ["86400", "24 hours"]] as const;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const accessEnded = (error: unknown) => error instanceof PayeeFailure && (error.failure.kind === "session" || error.failure.kind === "forbidden");

function Permissions({ permissions }: { permissions: readonly string[] }) {
  return <ul className="list-disc pl-5 text-sm">{permissions.map(p => <li key={p}>{CAN[p] ?? p}</li>)}</ul>;
}

/**
 * Connect the contributor's own agent to their reports on this entry. The token is shown once and never stored here;
 * the platform enforces the fixed permissions, expiry and revocation.
 */
export function AgentConnections({ account }: { account: string }) {
  const capabilities = useQuery(payeeQueries.capabilities());
  const offered = capabilities.data?.includes("supplier-agent-connections-v1") ?? false;
  const connections = useQuery({ ...payeeQueries.agentConnections(account), enabled: offered });
  const [label, setLabel] = useState(""), [ttl, setTtl] = useState("3600");
  const [token, setToken] = useState<{ value: string; connection: AgentConnection }>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [copied, setCopied] = useState(false);
  if (!offered) return null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: payeeQueries.agentConnections(account).queryKey });

  async function start(event: React.FormEvent) {
    event.preventDefault();
    const input = agentConnectionIssue.safeParse({ label, ttlSeconds: Number(ttl) });
    if (!input.success) { setMessage("Name the connection (up to 80 characters) and choose how long it lasts. Nothing was started."); return; }
    const started = currentEpoch();
    setBusy(true); setMessage(""); setCopied(false);
    try {
      const result = await payeeCommands.startAgentConnection(input.data);
      if (started !== currentEpoch()) return;
      setToken({ value: result.token, connection: result.connection }); setLabel("");
    } catch (error) { if (started === currentEpoch() && !accessEnded(error)) setMessage(error instanceof Error ? error.message : "The connection could not be started."); }
    finally { if (started === currentEpoch()) { setBusy(false); void refresh(); } }
  }
  async function revoke(connection: AgentConnection) {
    const started = currentEpoch();
    setMessage("");
    try { await payeeCommands.revokeAgentConnection(connection.id); if (started === currentEpoch()) setMessage(`"${connection.label}" is revoked. Its token no longer works.`); }
    catch (error) { if (started === currentEpoch() && !accessEnded(error)) setMessage(error instanceof Error ? error.message : "Revocation could not be confirmed."); }
    finally { if (started === currentEpoch()) void refresh(); }
  }

  const list = connections.data?.connections ?? [];
  return <section id="agent-connections" aria-labelledby="agent-connections-title" className="flex flex-col gap-5 rounded-xl border bg-card p-6">
    <div className="flex flex-col gap-2">
      <h2 id="agent-connections-title" className="text-xl font-semibold">Agent connections</h2>
      <p className="max-w-prose text-sm text-muted-foreground">Connect your own agent, such as a coding agent, to your contribution reports on this entry. It acts as you, with only these permissions, until it expires or you revoke it.</p>
    </div>
    <div className="grid gap-5 sm:grid-cols-2">
      <div><h3 className="mb-2 font-semibold">It can</h3><Permissions permissions={PAYEE_REPORT_PERMISSIONS} /></div>
      <div><h3 className="mb-2 font-semibold">It cannot</h3><ul className="list-disc pl-5 text-sm">{CANNOT.map(c => <li key={c}>{c}</li>)}</ul></div>
    </div>
    {token ? <div id="agent-token" role="status" className="flex flex-col gap-3 rounded-lg bg-warning-muted px-4 py-3 text-sm text-warning-muted-foreground">
      <p className="font-semibold">Copy this token now. It is shown only once.</p>
      <code className="break-all rounded bg-background px-2 py-1 text-foreground">{token.value}</code>
      <p>Anyone holding it can act as you for these reports on this entry until {when(token.connection.expiresAt)} or until you revoke it. Store it in a secret store or environment variable, and never paste it into a prompt, log or message.</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(token.value); setCopied(true); } catch { setMessage("Select the token above and copy it."); } }}>{copied ? "Copied" : "Copy token"}</Button>
        <Button variant="ghost" size="sm" onClick={() => setToken(undefined)}>Done, hide token</Button>
      </div>
    </div> : <form onSubmit={start} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="flex flex-col gap-2"><Label htmlFor="agent-label">Name this connection</Label><Input id="agent-label" maxLength={80} autoComplete="off" placeholder="My report agent" value={label} onChange={e => setLabel(e.target.value)} /></div>
        <div className="flex flex-col gap-2"><Label htmlFor="agent-ttl">Lasts</Label><NativeSelect id="agent-ttl" value={ttl} onChange={e => setTtl(e.target.value)}>{DURATIONS.map(([value, text]) => <NativeSelectOption key={value} value={value}>{text}</NativeSelectOption>)}</NativeSelect></div>
      </div>
      <Button type="submit" className="self-start" disabled={busy}>{busy ? "Starting…" : "Start agent connection"}</Button>
    </form>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">Your connections on this entry</h3>
      {connections.error && <p role="alert" className="text-sm">{connections.error.message}</p>}
      {connections.isSuccess && list.length === 0 && <p className="text-sm text-muted-foreground">No agent connections.</p>}
      <ul id="agent-connection-list" className="flex flex-col divide-y">
        {list.map(connection => {
          const active = !connection.revoked && Date.parse(connection.expiresAt) > Date.now();
          return <li key={connection.id} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium">{connection.label}</span>
              <span className="text-xs text-muted-foreground">{connection.revoked ? "Revoked" : active ? `Expires ${when(connection.expiresAt)}` : `Expired ${when(connection.expiresAt)}`}</span>
            </div>
            <Permissions permissions={connection.permissions} />
            <span className="text-xs text-muted-foreground">Acts as {connection.account} on {connection.instance === "/" ? "this entry" : connection.instance} at {connection.host}. Started {when(connection.createdAt)}.</span>
            {active && <Button variant="outline" size="sm" className="self-start" onClick={() => revoke(connection)}>Revoke {connection.label}</Button>}
          </li>;
        })}
      </ul>
    </div>
  </section>;
}
