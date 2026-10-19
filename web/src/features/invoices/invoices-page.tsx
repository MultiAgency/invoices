import { useState } from "react";
import { useSession } from "../../app/session";
import { SignInCard } from "../../app/sign-in";
import { Skeleton } from "../../components/ui/skeleton";
import { Payouts } from "./payouts";
import { RequestWork, WorkOrders } from "./work-orders";

/** Agree on the work, request a payout and follow it through approval to payment, with the receiving account. */
export function InvoicesPage({ workOrder }: { workOrder?: string }) {
  const session = useSession();
  return <div className="flex flex-col gap-6">
    <div className="max-w-2xl"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Invoices</h1>
      <p className="intro mt-3 text-base leading-7 text-muted-foreground">Agree on the work. Request a payout. Follow it through approval to payment, all with the NEAR account you want to receive funds.</p></div>
    {session.isPending ? <Skeleton className="h-48 w-full" />
      : !session.account ? <SignInCard title="Sign in as the payee" description="Use the NEAR account you want to receive funds. Signing in sends no payment." />
      : <Tasks key={session.account} account={session.account} agreed={session.agreed} workOrder={workOrder} />}
  </div>;
}

/** One account's tasks; a different account mounts a fresh set, so no state or draft crosses accounts. */
function Tasks({ account, agreed, workOrder }: { account: string; agreed: boolean; workOrder?: string }) {
  const [ordersChecked, setOrdersChecked] = useState(false);
  return <>
    <nav aria-label="Contributor tasks" className="flex flex-wrap gap-x-6 gap-y-3 border-b pb-4 text-sm">
      <a href="#request-work" className="underline-offset-4 hover:underline">Request a work order</a><a href="#work-orders-card" className="underline-offset-4 hover:underline">Your work orders</a>
      <a href="#step-invoice" className="underline-offset-4 hover:underline">Request a payout</a><a href="#list" className="underline-offset-4 hover:underline">Payout history</a>
    </nav>
    <RequestWork account={account} onRequested={() => setOrdersChecked(true)} />
    <WorkOrders account={account} initial={workOrder} checked={ordersChecked} onCheck={() => setOrdersChecked(true)} />
    <Payouts account={account} sessionAgreed={agreed} />
  </>;
}
