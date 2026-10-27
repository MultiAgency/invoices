import "./styles.css";
import { EMBED_BASE_KEY, embeddedBase } from "./shared/embed";

export type InvoicesMount = { unmount: () => void };

/**
 * The Module Federation entry: mounts Invoices into an element of a host app. `apiBase` is a path on the **host's own
 * origin** where the host serves or proxies the payee routes (`/gw/...`, `/a/...`); a full URL is refused, so the app
 * can only make same-origin calls and cookies and authorization headers never cross origins. The app keeps its
 * navigation in memory and never rewrites the host's URL. One base per page: set before the app's modules first load.
 */
export async function mount(element: HTMLElement, options: { apiBase: string }): Promise<InvoicesMount> {
  const base = embeddedBase(options?.apiBase);
  if (base === null) throw new Error("Invoices needs apiBase: a path on the host's own origin, such as \"/invoices-api\".");
  (globalThis as Record<string, unknown>)[EMBED_BASE_KEY] = base;
  const [{ StrictMode }, { createRoot }, { QueryClientProvider }, { RouterProvider, createMemoryHistory }, { queryClient }, { createInvoicesRouter }] = await Promise.all([
    import("react"), import("react-dom/client"), import("@tanstack/react-query"), import("@tanstack/react-router"), import("./app/session"), import("./app/routes"),
  ]);
  const router = createInvoicesRouter(createMemoryHistory({ initialEntries: ["/"] }));
  const root = createRoot(element);
  root.render(<StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></StrictMode>);
  return { unmount: () => root.unmount() };
}
