# AI Usage Journal

## Tool(s) used

- **Cursor** — inline chat

---

## Interaction Log

| # | What I asked the AI | Quality of AI response (1–5) | Accepted? | My reasoning |
|---|---------------------|------------------------------|-----------|--------------|
| 1 | Gave it the client brief and asked it to list ambiguities and open questions before I touched any code. | 4 | Partial | Good list overall. Missed the compliance angle around logging raw bank fields under PCI DSS — added that myself. Also its "real-time" interpretation was a bit vague so I tightened the wording. |
| 2 | Shared all three files and asked for a bug audit with severity and category. | 4 | Partial | Found the obvious stuff — SQL injection, empty discrepancies, the interval leak. I reorganised some severity ratings and split one entry that was doing too much into two rows. |
| 3 | Asked it to fix `reconciler.ts` — matching logic, float arithmetic, timezone handling, discrepancy detection. | 3 | Partial | The BigInt cents approach was good, kept that. The matching was reference-only with no fallback which wouldn't hold up in practice — bank exports don't always use our reference field. Extended it myself to add a secondary txnId check and an amount+date heuristic as last resort. The transaction wrapper was also missing row-level locking so I added `.for('update')` manually. |
| 4 | Asked it to fix the route — auth, error handling, GET endpoint shape. | 4 | Partial | Auth and error sanitisation were fine. The GET endpoint needed more thought — the original required an `id` which broke the dashboard list view entirely. Reworked that to support both list and single-run lookup. |
| 5 | Asked it to fix the dashboard — interval cleanup, `res.ok` check, summary card. | 4 | Yes | Output was clean. Adjusted the month filter to use UTC so the count doesn't drift by timezone. |

---

## Reflection

**Bugs AI found correctly** (that I then verified):

- SQL injection in both POST (`notes`) and GET (`id`) via string interpolation
- `discrepancies` array always empty — never populated in the loop
- `findMatch` matching on amount only — collision risk with duplicate amounts
- `totalBankAmount` summing unfiltered records, not just those in the period
- `useEffect` interval never cleaned up on unmount
- Period boundary mismatch — `between()` in the DB query is inclusive on both ends but `isInPeriod` uses exclusive upper bound; I caught this while reading through the fixed code

**Bugs AI missed or got wrong:**

- It didn't flag that `markReconciled` only handles `pending → reconciled`. That's the wrong lifecycle state — you'd reconcile a `cleared` payment, not a pending one. Caught this when I was reading through the status logic and it felt off.
- Its rewrite still marked discrepancy-matched payments as reconciled even when amounts didn't match. Fixed that by skipping the status update for the discrepancy branch.
- Concurrency — it suggested a DB transaction was enough. That's not quite right; without row-level locking, two simultaneous reconciliation requests can both see the same unmatched payments. Added `.for('update')` to handle that.

**AI-generated code I rejected:**

- The initial `findMatch` rewrite — reference-only, no fallback. Replaced with the three-tier `resolveMatch` since bank exports vary in which field they use as the identifier.

**The moment I most doubted the AI output and how I verified it:**

The transaction-is-enough claim for concurrency. I worked through what two overlapping requests would actually see and realised they'd both read the same rows before either had committed. Added the row lock and moved on.

**What you know that the AI does not:**

Payment lifecycle semantics. `pending` means the transaction hasn't settled — reconciling it against a bank posting at that stage is premature. The AI defaulted to what the original code did without questioning whether it made sense.
