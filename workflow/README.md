# Payee workflow steps

`payee.mjs` drives the **actual Invoices page** as the payee: direct invoices, contribution reports and work-order filing. It runs against an isolated local Proto stack with a simulated provider. Each step prints one JSON result line and appends it, with the identities Proto returned, to a receipt.

Proto keeps every record and performs every check. This script holds no grant, executor or credential. It refuses any origin that is not loopback.

**Simulated:** wallet signatures (fixture test key), deposits, provider and settlement. A passing run is not evidence of mainnet behaviour.

## Start a stack

From Proto, or from a frozen Proto stack snapshot:

```sh
node <proto>/test/e2e/run.mjs --stack --invoices-dist <frozen Invoices dist> [--headed]
# prints: Isolated stack ready: <run>/stack/state.json
```

The payee steps attach over the stack's `cdp`. They drive only the wallet context whose page is on the stack's `payee` origin, never the owner's. Owner steps and story orchestration belong to Payables' recipes, which call these steps as a separate process.

## Steps

```sh
node workflow/payee.mjs <step> --session <run>/stack/state.json --scenario <scenario.json> [--receipt <file>] [--order ID] [--until S] [--fault lost-response]
```

| Step | Page action | Returned identity | Guard |
| --- | --- | --- | --- |
| `invoice submit` | Amount, note, **Submit invoice** | page-minted `submission`, `invoiceId`, `status` | once per receipt |
| `invoice status [--until paid]` | **Check invoice status again** | `invoiceId`, `status` | reads only |
| `report submit` | **New report**, contributions, assessment, evidence, **Submit** | `requestId`, `commandId`, `version`, `state` | once per receipt |
| `report status [--until S]` | **Refresh** | `state`, `approvedAmount`, `payment`, `paymentStatus` | reads only |
| `order list` | **Check work orders** | order ids with fixed terms | reads only |
| `order file --order ID [--confirm human]` | **File work order invoice**, then the page's own confirmation (accepted by the step, or by a person with `--confirm human`) | `orderId`, `invoiceId`, `status`; `already_filed` with the same `invoiceId` if another tab filed it | once per receipt; refused until the order is ready |
| `order status [--order ID] [--until paid]` | order detail | `invoiceStatus` | reads only |
| `<kind> resume` | the page's retained draft, resubmitted | the same identity | only after a lost response |

Exit codes: 0 means the step was recorded or read. 1 means Proto refused it, or the order is not ready. Any other non-zero exit is a guard: stderr says why, and nothing was sent.

**Unknown outcomes.** `--fault lost-response` is a simulated loss: Proto processes the submission, and the browser never receives the answer. The step records `outcome: "unknown"` and refuses any further submission from that receipt.

`resume` checks that the page still retains the same `submission` (invoice), `commandId` (report) or order. Only then does it resend, and Proto returns the original record. `resume` never resends a submission Proto recorded.

When Proto itself reports `unknown`, `needs_review` or `failed`, the result says to observe and reconcile; there is no replacement. Proto's invoice list does not expose submission identities, so after a lost invoice response `status` cannot match the record by itself (see Gaps).

## Driver and release

Receipts record the driver's sha256, so a rehearsal can rerun a recorded run with the driver it used. Each frozen release's own driver is in its recorded source, `.test-artifacts/releases/<release id>.source.tar`, next to the release.

| Release | Driver sha256 | Get it |
| --- | --- | --- |
| I `7096493e…3c33` | `e5e21a75472a558c…` (the checkpoint receipts) | `tar -xOf .test-artifacts/releases/7096493e44b4f8b5ab6608e73b5ff851c6befa9fffe91175973e372b9d381c33.source.tar workflow/payee.mjs > <dir>/payee.mjs` |
| J (in source) | the working tree's `workflow/payee.mjs` | — |

The current driver also drives I: it uses the report form when the page has already opened it, and otherwise clicks "New report" or "Resume draft". So it fits both I's landing and J's requests-first landing; the offline step tests pass against I's frozen release and J's build. To reproduce a recorded receipt exactly, use the driver with its recorded sha256.

## Scenarios

The steps accept Invoices' examples and Payables' story files unchanged. `payee` may be an account string or `{account, base}`; `base` is a scoped `/i/own-<24 hex>` entry.

- **Direct invoice:** `examples/direct-invoice.json` (`invoice: {amount, note}`), or a Payables file with top-level `amountUsdc` and `note`.
- **Contribution report:** `examples/contribution-report.json` (`report: {contributions, assessment, evidence, [amount], [start], [end]}`). The period defaults to the recorded agreement's.
- **Order filing:** any scenario naming the payee. The order fixes recipient, amount and deadline, so filing takes no terms of its own.

Story names (Sally, Northside Garden) are display labels only; the fixture accounts are `payee.near` and `owner.near`. A different story changes inputs, not code.

## Video outlines

**Send an invoice (direct).**
1. The contributor opens the Invoices page and submits 1.25 USDC for "October design work". Show `invoiceId` and status `waiting`.
2. Owner decision (Payables): approve the held payout. The signature is *simulated*.
3. The contributor checks again and sees `paying`: approval is not settlement.
4. Settlement is *simulated*. The contributor sees `paid` for the same `invoiceId`; there is one transfer.
5. Failure cut: the response is lost, and the step reports `unknown` and refuses a replacement. `resume` resends the same submission and gets back the same invoice.

**Send an invoice (contribution report).**
1. The contributor opens `/report` under a recorded agreement and submits contributions, assessment and evidence. Show `requestId` and state `submitted`. Nothing is paid.
2. Owner decision (Payables): set compensation. The contributor sees `approved` and the approved amount, with no payment yet.
3. The owner prepares the isolated payout. The contributor sees the payment as `preparing`; the order's own authorization and funding follow (Payables).
4. The contributor files the order invoice, the owner approves and settlement is *simulated*. The contributor sees the payment status.
5. Failure cut: the submission response is lost. `resume` resends the same `commandId`, the same request comes back at version 1, and only one request exists.

**Sally's order (payee side).**
1. `order list` shows the fixed terms. Filing early is refused: the order is not ready.
2. After owner authorization and *simulated* funding, `order file` returns `invoiceId` with status `waiting`. A second tab (another receipt) returns the same `invoiceId`.
3. After approval the contributor sees `paying`. After *simulated* settlement, `order status --until paid` shows `paid`.

## Gaps

- Filing through the page needs a Proto stack that leaves page dialogs open (snapshot `bf6cf8c4…` or later). The earlier snapshot `b643b963…` auto-dismisses them.
- Proto's simulator accepts only the fixture payee `payee.near`.
- After a lost direct-invoice response, matching by identity needs `submission` in the invoice list (requested from Proto as P1 1.1).
- Scoped `/i/own-…` entries are supported by `payee.base` but not exercised by the shared stack.
- Payables' recipes call these steps with `--payee-steps`; without it they call Proto's `payeeClient` directly.
