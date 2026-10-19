import { QueryClient, queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { ACCESS_ENDED, BASE, client, settle, PayeeFailure } from "../shared/client";
import { connector } from "../shared/wallet";

/**
 * Reads are not retried or refetched on focus: a payee sees exactly what was last read and checks
 * again deliberately. Mutations are never retried; each keeps its caller's identity.
 */
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });

export type Session = { account: string | null; agreed: boolean };

/** One payee session covers invoices, work orders and reports on this instance (Proto sets one cookie). */
export const sessionQuery = queryOptions({
  queryKey: ["session", BASE],
  queryFn: async (): Promise<Session> => settle(await client.session(), "Your sign-in status could not be checked. Sign in to see your records."),
  staleTime: Infinity,
});

/**
 * Every account change advances the epoch. An answer that arrives for an earlier epoch (a late response
 * after sign-out, account switch or expiry) is discarded, and never ends a newer account's access.
 */
let epoch = 0;
export const currentEpoch = () => epoch;

let accessMessage = "";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
/** Why the last account's records were hidden (an expired session or refused access), until the next sign-in. */
export function useAccessMessage() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => accessMessage);
}

/** Shows `session`: every private record of any earlier account is dropped first; drafts stay in storage. */
export function setAccount(session: Session, message = "") {
  epoch++;
  accessMessage = message; notify();
  void queryClient.cancelQueries({ predicate: query => query.queryKey[0] !== "session" });
  queryClient.removeQueries({ predicate: query => query.queryKey[0] !== "session" });
  queryClient.setQueryData(sessionQuery.queryKey, session);
}

/**
 * Runs one payee call for the current account. A 401 or 403 answered within the same epoch hides that
 * account's records (both keep drafts and identities); a late one for an earlier account changes nothing.
 */
export async function forAccount<T>(work: () => Promise<T>): Promise<T> {
  const started = epoch;
  try { return await work(); }
  catch (error) {
    const kind = error instanceof PayeeFailure ? error.failure.kind : undefined;
    if ((kind === "session" || kind === "forbidden") && started === epoch) setAccount({ account: null, agreed: false }, ACCESS_ENDED[kind]);
    throw error;
  }
}

export function useSession() {
  const query = useQuery(sessionQuery);
  return { ...query, account: query.data?.account ?? null, agreed: query.data?.agreed ?? false };
}

const fromBase64 = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));

/** Wallet sign-in: the wallet signs Proto's challenge message; nothing is sent on-chain or spent. */
export function useSignIn() {
  return useMutation({
    mutationFn: async () => {
      const challenge = settle(await client.signInChallenge(), "Sign-in is unavailable right now. Try again.");
      await connector.connect();
      const { wallet } = await connector.getConnectedWallet();
      const signed = await wallet.signMessage({ message: challenge.message, recipient: challenge.recipient, nonce: fromBase64(challenge.nonce) });
      const callbackUrls = [...new Set([location.origin + location.pathname, location.href.split("#")[0]!, location.origin + "/"])];
      // Sign-in carries no payment identity: a lost answer just needs another sign-in.
      const result = await client.signIn({ accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: challenge.nonce, callbackUrls });
      if (!result.ok && (result.kind === "unknown" || result.kind === "unavailable")) throw new Error("Sign-in could not be confirmed. Try again.");
      return settle(result, "Sign-in could not be confirmed. Try again.");
    },
    onSuccess: result => setAccount({ account: result.account, agreed: result.agreed ?? false }),
  });
}

export function useSignOut() {
  return useMutation({
    mutationFn: async () => {
      settle(await client.signOut(), "Sign-out could not be confirmed. Try again.");
      await connector.disconnect().catch(() => {});
    },
    onSuccess: () => setAccount({ account: null, agreed: false }),
  });
}
