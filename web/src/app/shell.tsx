import { Link, Outlet } from "@tanstack/react-router";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { MULTIAGENCY_ICON } from "../shared/brand";
import { useAccessMessage, useSession, useSignOut } from "./session";

/** One frame for the payee's tasks: who is signed in, the two task areas, and why records were hidden. */
export function Shell() {
  const session = useSession(), signOut = useSignOut(), ended = useAccessMessage();
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-10">
      <Link to="/" className="flex items-center gap-3 font-semibold"><span className="size-7" dangerouslySetInnerHTML={{ __html: MULTIAGENCY_ICON }} />MultiAgency <span className="font-normal text-muted-foreground">/ Invoices</span></Link>
      <nav aria-label="Contributor tasks" className="flex flex-wrap gap-5 text-sm">
        <Link to="/" activeOptions={{ exact: true }} className="underline-offset-4 hover:underline [&.active]:font-semibold">Invoices &amp; work orders</Link>
        <Link id="report-link" to="/report" className="underline-offset-4 hover:underline [&.active]:font-semibold">Report &amp; payment requests</Link>
      </nav>
      {session.account && <div id="portal-session" className="account flex min-w-0 items-center gap-3 text-sm">
        <span>Signed in as <code id="account" className="break-all">{session.account}</code></span>
        <Button id="signout" variant="ghost" disabled={signOut.isPending} onClick={() => signOut.mutate()}>Sign out</Button>
      </div>}
    </div></header>
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-10">
      {ended && !session.account && <Alert variant="warning"><AlertDescription id="access-ended" role="alert">{ended}</AlertDescription></Alert>}
      {signOut.error && <p role="alert" className="text-sm">{signOut.error.message}</p>}
      <Outlet />
      <footer className="flex flex-wrap justify-between gap-3 border-t pt-6 text-xs text-muted-foreground"><span>Evidence first. Approval before payment.</span><a className="underline" href="/skill.md">For your coding agent</a></footer>
    </main>
  </div>;
}
