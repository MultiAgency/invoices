import { createInvoicesRouter } from "./routes";

/** The standalone app's router: the browser's own history, under the payee base. */
export const router = createInvoicesRouter();

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
