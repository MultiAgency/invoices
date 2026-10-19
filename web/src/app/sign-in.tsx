import { currentEpoch, useSignIn } from "./session";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";

/** Signed-out view of a payee task. After a sign-out or expiry, keyboard focus returns to the sign-in button. */
export function SignInCard({ title, description }: { title: string; description: string }) {
  const signIn = useSignIn();
  return <Card id="step-signin" className="max-w-xl">
    <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
    <CardContent><p className="text-sm text-muted-foreground">Your wallet signs a message proving you control the account. It doesn't send a transaction or spend anything.</p></CardContent>
    <CardFooter className="flex flex-col items-start gap-3">
      <Button id="signin" autoFocus={currentEpoch() > 0} disabled={signIn.isPending} onClick={() => signIn.mutate()}>Sign in with NEAR</Button>
      {signIn.error && <p role="alert" className="text-sm text-destructive">{signIn.error.message}</p>}
    </CardFooter>
  </Card>;
}
