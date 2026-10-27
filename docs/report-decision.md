# Decision: contribution reports and dashboard reports are different objects

Status: proposed here for the maintainers to accept. The matching note for the dashboard repository is at the end.

## What each one is

| | Contribution report (Invoices) | Report (dashboard) |
|---|---|---|
| Author | A contributor, signed in with their NEAR account | The agency, from its project data |
| Content | Submitted work and impact | A snapshot of a project's budgets, billings and contributors |
| Audience | The owner (wallet or DAO) reviewing compensation | The agency, and optionally its client, shareable by token |
| Purpose | Input to owner compensation review. Submission is not payment | Client-facing reporting on a project |
| Key | The contributor's NEAR account | The engagement or project |

They share a word and nothing else. They are **unrelated objects**, not two views of one.

## Decision

1. **Keep them separate.** Neither is stored in, derived from or merged into the other. A contribution report is never part of a dashboard report.
2. **Visibility.** A contribution report is visible to its author and to the owner reviewing it. It is never shown to a client, and a client-shareable
   report must not read contribution reports. This is the protection against compensation reviews appearing in client reports.
3. **Possible relation, later.** A contribution report may name the project it was written for (the optional project reference in
   the contributor-link note (docs/contributor-link.md)). If an agency later wants to use contribution reports as input to its own client report, that is an explicit,
   owner-side choice made per report, never automatic and never a change to who can see the original.
4. **Naming.** Invoices keeps "contribution report", which already says what it is. The dashboard's "report" is the one that is ambiguous:
   it should read "project report" or "client report" wherever a contributor can see both apps.

## Follow-ups (each its own issue, not done here)

- Dashboard: rename "report" to "project report" or "client report" in contributor-visible screens.
- If wanted: an owner-side way to reference a contribution report from a project report, with its visibility rules written first.
- Gateway/backend: a test that a client-scoped token cannot read contribution reports.

## Note for the dashboard repository (to copy there)

> **Dashboard reports and Invoices contribution reports are different objects.** A dashboard report is an agency's snapshot of a project's budgets, billings
> and contributors, shareable with a client by token. A contribution report (MultiAgency/invoices) is a contributor's submitted work and impact, for owner
> compensation review, visible only to its author and the reviewing owner. They are not merged, and a client report must never include contribution reports.
> Decision: MultiAgency/invoices `docs/report-decision.md`.
