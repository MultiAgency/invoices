import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { BASE } from "../shared/client";
import { InvoicesPage } from "../features/invoices/invoices-page";
import { ReportPage } from "../features/report/report-page";
import { Shell } from "./shell";

const root = createRootRoute({ component: Shell });
const id = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value) ? value : undefined;
/** `?workOrder=<id>` opens one work order directly, as owner and recipe links do. */
const validateSearch = (search: Record<string, unknown>): { workOrder?: string } => ({ workOrder: id(search.workOrder) });
/** `?agreement=<id>` starts a new report on those terms; `?request=<id>` opens that request. Both survive reload and back. */
const validateReportSearch = (search: Record<string, unknown>): { agreement?: string; request?: string } =>
  ({ agreement: id(search.agreement), request: id(search.request) });
function Invoices() { return <InvoicesPage workOrder={invoices.useSearch().workOrder} />; }
const invoices = createRoute({ getParentRoute: () => root, path: "/", validateSearch, component: Invoices });
function Submit() { return <InvoicesPage workOrder={submit.useSearch().workOrder} />; }
const submit = createRoute({ getParentRoute: () => root, path: "/submit", validateSearch, component: Submit });
function Report() {
  const navigate = report.useNavigate();
  return <ReportPage search={report.useSearch()} navigate={search => void navigate({ search })} />;
}
const report = createRoute({ getParentRoute: () => root, path: "/report", validateSearch: validateReportSearch, component: Report });

/**
 * The release declares exactly these entries, and the gateway forwards exactly these paths, at the root
 * intake or under one owner's scoped base; a trailing slash is accepted on each.
 */
export const router = createRouter({ basepath: BASE || "/", trailingSlash: "preserve", routeTree: root.addChildren([invoices, submit, report]) });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
