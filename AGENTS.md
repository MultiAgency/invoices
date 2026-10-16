# Invoices agent guide

Read CONTEXT.md, README.md and ../HANDOFF.md first. This is a standalone supplier frontend, not an executor or authorization service. Do not copy backend gateways, grants, state or credentials here. Preserve stable request/command identities, scoped URLs, account isolation, late-response redaction and unknown outcomes. Do not add automatic mutation retries or infer settlement from approval.

Coordinate concurrent edits in all sibling repositories; source-provenance.json is an extraction record, not authorization to overwrite newer work. The user makes commits. Do not deploy, restart production, issue live credentials, sign owner actions or move funds. Backend money-path changes require Proto's instructions and the current unattended-run/freeze check.

Before completion run pnpm typecheck, pnpm build, pnpm test and pnpm test:browser. For contract changes also run Proto's isolated simulated-provider E2E with --invoices-dist. Keep claims calibrated to offline tests versus hosted observations. Keep owner reviews in Payables and shared consent in Proto.
