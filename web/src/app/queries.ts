import { queryOptions } from "@tanstack/react-query";
import type { Result } from "@multiagency/sdk/payee";
import { setAccount, forAccount } from "./session";
import { BASE, client, LOST, settle } from "../shared/client";

/**
 * The app's TanStack Query adapter over Proto's typed payee client (`@multiagency/sdk/payee`).
 * Every key starts with its route, the payee instance (BASE) and the account, so records never cross
 * instances or accounts. Reads are not retried; mutations are never retried and keep their caller's identity.
 * A 401 or 403 within the same account epoch hides that account's records (see forAccount).
 */
const read = <T>(unavailable: string, call: () => Promise<Result<T>>) => () => forAccount(async () => settle(await call(), unavailable));
const write = <T>(call: () => Promise<Result<T>>) => forAccount(async () => settle(await call(), LOST));

export const payeeQueries = {
  /** Public metadata of this entry: which optional payee features the platform offers. */
  capabilities: () => queryOptions({ queryKey: ["capabilities", BASE] as const, staleTime: Infinity,
    queryFn: async () => { const result = await client.capabilities(); return result.ok ? result.value.capabilities : []; } }),
  agentConnections: (account: string) => queryOptions({ queryKey: ["agent-connections", BASE, account] as const,
    queryFn: read("Your agent connections could not be loaded. Refresh before acting.", () => client.agentConnections()) }),
  invoices: (account: string) => queryOptions({ queryKey: ["invoices", BASE, account] as const,
    queryFn: read("Invoice status could not be checked. Showing the last loaded records.", () => client.invoices()) }),
  workOrders: (account: string) => queryOptions({ queryKey: ["work-orders", BASE, account] as const,
    queryFn: read("Work orders unavailable. Refresh before acting.", () => client.workOrders()) }),
  workOrder: (account: string, id: string) => queryOptions({ queryKey: ["work-orders", BASE, account, id] as const,
    queryFn: read("Work order status unavailable. Refresh before acting.", () => client.workOrder(id)) }),
  compensation: (account: string) => queryOptions({ queryKey: ["compensation", BASE, account] as const,
    queryFn: () => forAccount(async () => {
      const view = settle(await client.compensation(), "Your requests could not be loaded. Showing what was last loaded; refresh before acting.");
      // Another tab signed in a different account: follow it rather than show its records under this one.
      if (view.account !== account) setAccount({ account: view.account, agreed: false });
      return view;
    }) }),
};

/** Payee commands. Each takes its identity from the caller; an unknown outcome surfaces as LOST, never a retry. */
export const payeeCommands = {
  submitInvoice: (input: Parameters<typeof client.submitInvoice>[0]) => write(() => client.submitInvoice(input)),
  continueInvoice: (id: string) => write(() => client.continueInvoice(id)),
  requestWorkOrder: (input: Parameters<typeof client.requestWorkOrder>[0]) => write(() => client.requestWorkOrder(input)),
  fileWorkOrder: (id: string) => write(() => client.fileWorkOrder(id)),
  submitReport: (command: Parameters<typeof client.submitReport>[0]) => write(() => client.submitReport(command)),
  /** Not a money action: a lost answer is `unavailable`, and any connection it started is listed and revocable. */
  startAgentConnection: (input: { label: string; ttlSeconds: number }) => forAccount(async () => settle(await client.startAgentConnection(input),
    "The answer was lost, so it is unclear whether a connection started. Check the list below and revoke any connection whose token you didn't save.")),
  revokeAgentConnection: (id: string) => forAccount(async () => settle(await client.revokeAgentConnection(id), "Revocation could not be confirmed. Check the list before relying on it.")),
};
