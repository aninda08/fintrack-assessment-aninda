## Clarifications / Assumptions Log

Below is a comprehensive list of ambiguities and unanswered questions inferred from the client brief (and a few that surface immediately when auditing the starter code). For each item: the exact quote, my assumed interpretation, and why.

---

1. **Scope of “bank statements” vs “bank records”**
   - **Ambiguous quote**: “comparing our internal payment records against bank statements” and “Accept a batch of bank records (uploaded as JSON, representing a CSV import)”
   - **Assumed interpretation**: A “bank record” is a single bank transaction line item from a statement export; the upload is a batch for one account/statement period.
   - **Why**: The upload format is line-oriented (CSV→JSON). Treating each record as one statement row aligns with typical reconciliation workflows and simplifies matching/pairing.

2. **Definition of “given period”**
   - **Ambiguous quote**: “Match them against internal payment records for a given period”
   - **Assumed interpretation**: Period is an inclusive start timestamp and exclusive end timestamp in UTC (or a single agreed business timezone), applied to both bank `valueDate` and internal `createdAt` (or their most appropriate posting/settlement timestamps).
   - **Why**: Half-open intervals avoid double-counting boundary events; using a single canonical timezone prevents DST and client-locale inconsistencies.

3. **Which bank date field should be used for period filtering**
   - **Ambiguous quote**: “bank statements” / “valueDate” (implied by import)
   - **Assumed interpretation**: Filter bank transactions by the bank-provided posting/value date (the uploaded `valueDate`).
   - **Why**: Statements typically reconcile on posted/value dates; using “transaction initiation time” (if different) causes drift and false unmatched items.

4. **Meaning of “real-time” reconciliation**
   - **Ambiguous quote**: “The system should do reconciliation in real-time — we can't wait for a nightly job”
   - **Assumed interpretation**: Reconciliation should run synchronously on-demand at upload time (seconds, not hours), returning a report immediately; no scheduled batch job required for core flow.
   - **Why**: The product need is responsiveness for finance operations; “real-time” in fintech often means “user-triggered, immediate feedback,” not streaming ingestion.

5. **Matching rules / required matching keys**
   - **Ambiguous quote**: “Payments need to be properly matched against the bank records”
   - **Assumed interpretation**: Primary match is on a stable external reference (e.g., payment `externalRef` vs bank `reference`/`transactionId`), with secondary heuristics (amount, date proximity, description) only as fallback, and never many-to-many without an explicit rule.
   - **Why**: Amount-only matching is unsafe (collisions are common). Using a stable identifier first reduces false positives, which are expensive for finance teams to unwind.

6. **One-to-one vs one-to-many matching**
   - **Ambiguous quote**: “matched pairs”
   - **Assumed interpretation**: Core MVP supports **one bank record ↔ one internal payment**; splits/aggregations (one payment paid in multiple bank entries, or multiple payments in one bank deposit) are out of scope unless specified.
   - **Why**: The brief explicitly says “pairs” and is time-constrained (“finish … today”). Split/aggregate matching requires additional modeling and UI review flows.

7. **Handling duplicates in uploaded bank data**
   - **Ambiguous quote**: “Accept a batch of bank records”
   - **Assumed interpretation**: Duplicate `transactionId`s in an upload should be rejected or de-duplicated deterministically (e.g., first occurrence wins, remainder flagged).
   - **Why**: Bank exports can be re-imported; deterministic duplicate handling prevents double reconciliation and inconsistent totals.

8. **Currency handling details (beyond “USD only for now”)**
   - **Ambiguous quote**: “We handle multiple currencies but for now just focus on USD”
   - **Assumed interpretation**: Reject non-USD bank records/payments for MVP (or treat them as unmatched with a clear reason), and format all money as USD; no FX conversion.
   - **Why**: “Focus on USD” implies no multi-currency math; silent conversion or mixed-currency summation would be misleading and risky.

9. **What qualifies as a “discrepancy”**
   - **Ambiguous quote**: “Any discrepancies should be flagged so the team can review them”
   - **Assumed interpretation**: A discrepancy is a **candidate match** where a key attribute differs (amount mismatch, currency mismatch, date outside tolerance, reference mismatch), producing a flagged item separate from “matched” and “unmatched.”
   - **Why**: Finance teams typically want “matched” to mean “good” and “discrepancy” to mean “needs review,” even if it’s probably the same transaction.

10. **Tolerance rules for amount and date**
   - **Ambiguous quote**: “properly matched” and “discrepancies”
   - **Assumed interpretation**: Exact match required for amount in MVP (cents-precision), and exact date-in-period for filtering; configurable tolerance (e.g., ±1 day, fee adjustments) is out of scope unless explicitly requested.
   - **Why**: Tolerances are domain-specific and can mask real issues; strict defaults are safer for an MVP unless the business defines acceptable variance.

11. **Which internal payments are eligible (statuses)**
   - **Ambiguous quote**: “internal payment records”
   - **Assumed interpretation**: Only payments that are settled/cleared are eligible to match bank records; pending/failed/voided are excluded or appear as system-only unmatched depending on policy.
   - **Why**: Reconciling pending transactions against bank postings creates false mismatches; “internal payment records” needs a business rule on what “counts.”

12. **Idempotency and re-running reconciliation**
   - **Ambiguous quote**: “Persist the reconciliation run to the database” and “Display past reconciliation runs”
   - **Assumed interpretation**: Reconciliation runs are immutable snapshots; re-running the same period/upload creates a new run with its own ID, and matched status changes are recorded consistently.
   - **Why**: Auditability is critical in finance. Overwriting prior runs harms traceability; snapshots support review and compliance.

13. **What exactly must be persisted (raw data vs summary)**
   - **Ambiguous quote**: “Persist the reconciliation run to the database”
   - **Assumed interpretation**: Persist (a) run metadata (period, created_at, notes, status), (b) summary totals, and (c) enough linkage to reproduce the report (matched pair identifiers + unmatched identifiers). Raw uploaded bank payload storage is optional and should be governed by compliance requirements.
   - **Why**: A “run” implies you can revisit it; without storing match links, you can’t display past results reliably. But storing raw bank data has compliance/retention implications.

14. **Dashboard requirements (what constitutes “past runs”)**
   - **Ambiguous quote**: “Display past reconciliation runs in a dashboard”
   - **Assumed interpretation**: Show a list of runs with period, counts, totals/difference, status, created_at, and ability to drill into run details (matched/unmatched/discrepancies).
   - **Why**: A list alone is low value; finance teams need to review what drove mismatches. The brief doesn’t specify drill-down but it’s a natural expectation for “review.”

15. **Period overlap and multiple accounts**
   - **Ambiguous quote**: “bank statements” (plural) and “given period”
   - **Assumed interpretation**: MVP assumes a single bank account/source per run; multiple accounts or overlapping runs are allowed but treated independently by run ID (no global locking).
   - **Why**: Account scoping is not mentioned, yet real businesses have multiple accounts. Without scoping, totals can mix unrelated cash flows.

16. **Input validation expectations for upload**
   - **Ambiguous quote**: “uploaded as JSON, representing a CSV import”
   - **Assumed interpretation**: The API should validate schema strictly (required fields, types, non-empty IDs, currency = USD) and reject invalid rows with clear error reporting.
   - **Why**: CSV imports are messy. Silent coercion increases reconciliation noise and undermines trust in the automation.

17. **Security/compliance: what can be logged and who can access it (compliance-focused)**
   - **Ambiguous quote**: “Compliance is critical — we're PCI DSS Level 1 and SOC 2 certified”
   - **Question**: Are we allowed to persist or log raw bank record fields such as `description`/`reference` (which may contain PII), and what are the data retention + access control requirements for reconciliation runs and uploads?
   - **Assumed interpretation (until clarified)**: Treat uploaded bank data and reconciliation outputs as sensitive; avoid logging raw payloads; enforce least-privilege access; define retention (e.g., 90 days for raw uploads, longer for summaries) and produce an audit trail for run creation/viewing.
   - **Why**: PCI/SOC2 imply strict controls around sensitive data, logging, retention, and auditing. Even if card data isn’t present, bank descriptors can include personal identifiers.

18. **Error reporting format and failure modes**
   - **Ambiguous quote**: “finish the core feature — today” (implies operational reliability)
   - **Assumed interpretation**: API should return user-safe errors (no stack traces), and a run should be marked failed with an error summary suitable for UI display.
   - **Why**: Exposing stack traces can leak internals and potentially sensitive data; operationally, finance users need actionable failure reasons.

19. **“Discrepancy” calculation: totals vs per-transaction**
   - **Ambiguous quote**: “Produce a reconciliation report: matched pairs, unmatched items, and discrepancies”
   - **Assumed interpretation**: Report includes both (a) overall totals difference and (b) per-transaction discrepancies for candidate matches; overall difference alone is not sufficient.
   - **Why**: A net difference doesn’t tell you where to investigate; per-transaction flags guide the finance team.

20. **Code-audit surfaced: expected API shape for listing runs**
   - **Ambiguous quote**: “Display past reconciliation runs in a dashboard”
   - **Question**: Should `GET /api/v1/reconcile` return **all runs** (paginated) or require a run `id`? What is the exact response shape (e.g., `{ runs: [...] }` vs raw array)?
   - **Assumed interpretation**: The dashboard expects a paginated list endpoint returning `{ runs: ReconciliationRun[] }` without requiring an `id`.
   - **Why**: A dashboard list view needs “list all” semantics; requiring an ID makes it impossible to discover runs unless another endpoint exists.

---

## One question I would NOT ask the client

**I would not ask**: “Should we implement the API using parameterized queries to avoid SQL injection and avoid returning stack traces in 500 responses?”

- **Why this is an engineering decision**: Secure query construction and safe error responses are baseline implementation requirements (especially under PCI/SOC2 posture). The client shouldn’t decide *whether* we mitigate injection/logging risks; we should implement it correctly by default.
