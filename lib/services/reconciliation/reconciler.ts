import { eq, and, gte, lt, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { payments, reconciliations } from '@/lib/db/schema'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BankRecord {
  transactionId: string
  amount: number          // dollar value, e.g. 19.99
  currency: string
  valueDate: string       // ISO date string from bank, e.g. "2026-01-15T14:30:00"
  description: string
  reference: string
}

export interface Payment {
  id: string
  externalRef: string
  amount: number          // dollar value, e.g. 19.99
  currency: string
  createdAt: Date
  status: 'pending' | 'cleared' | 'reconciled' | 'disputed'
}

export interface ReconciliationResult {
  id: string
  matched: MatchedPair[]
  unmatched: { bankOnly: BankRecord[]; systemOnly: Payment[] }
  discrepancies: Discrepancy[]
  summary: {
    totalBankAmount: number
    totalSystemAmount: number
    difference: number
  }
}

export interface MatchedPair {
  bankRecord: BankRecord
  payment: Payment
}

export interface Discrepancy {
  bankRecord: BankRecord
  payment: Payment
  amountDelta: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasExplicitTz(isoString: string): boolean {
  return /([zZ]|[+-]\d{2}:\d{2})$/.test(isoString)
}

/**
 * Parse bank record timestamps in a timezone-aware way.
 *
 * Banks sometimes export ISO strings *without* a timezone suffix. In JS, those are interpreted
 * as local time, which makes reconciliation non-deterministic across deployments.
 *
 * Strategy:
 * - If the string includes `Z` or an explicit offset, respect it.
 * - Otherwise assume UTC by appending `Z`.
 */
function parseBankDate(isoString: string): Date {
  const normalized = hasExplicitTz(isoString) ? isoString : `${isoString}Z`
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid bank valueDate: ${isoString}`)
  return d
}

function isInPeriod(date: Date, periodStart: Date, periodEnd: Date): boolean {
  return date >= periodStart && date < periodEnd
}

function toCents(amount: number): bigint {
  if (!Number.isFinite(amount)) throw new Error(`Invalid amount: ${amount}`)
  // Avoid accumulating float error by converting each value to integer cents.
  const cents = Math.round(amount * 100)
  const drift = Math.abs(amount * 100 - cents)
  if (drift > 1e-6) throw new Error(`Amount has more than 2 decimal places: ${amount}`)
  return BigInt(cents)
}

function fromCents(cents: bigint): number {
  return Number(cents) / 100
}

function amountDelta(bankAmount: number, systemAmount: number): number {
  return fromCents(toCents(bankAmount) - toCents(systemAmount))
}

type MatchOutcome =
  | { type: 'matched'; payment: Payment }
  | { type: 'discrepancy'; payment: Payment; delta: number }
  | { type: 'unmatched' }

/**
 * Explicit matching strategy (ordered):
 * 1) Exact reference match: payment.externalRef equals bank.reference.
 * 2) Exact id match: payment.externalRef equals bank.transactionId (some exports use txn id as reference).
 * 3) Fallback unique heuristic: same currency, same amount (in cents), and bank valueDate within the period
 *    and within the same UTC day as payment.createdAt.
 *
 * Rationale: Reference match is the most stable identifier and minimizes false positives; heuristics are
 * only used when they produce a unique candidate.
 */
function resolveMatch(bankRecord: BankRecord, candidates: Payment[]): MatchOutcome {
  const bankCents = toCents(bankRecord.amount)

  const byReference = candidates.filter(p => p.externalRef === bankRecord.reference)
  if (byReference.length === 1) {
    const p = byReference[0]
    const delta = amountDelta(bankRecord.amount, p.amount)
    return delta === 0 ? { type: 'matched', payment: p } : { type: 'discrepancy', payment: p, delta }
  }
  if (byReference.length > 1) return { type: 'unmatched' } // ambiguous; treat as unmatched for MVP

  const byTxnId = candidates.filter(p => p.externalRef === bankRecord.transactionId)
  if (byTxnId.length === 1) {
    const p = byTxnId[0]
    const delta = amountDelta(bankRecord.amount, p.amount)
    return delta === 0 ? { type: 'matched', payment: p } : { type: 'discrepancy', payment: p, delta }
  }
  if (byTxnId.length > 1) return { type: 'unmatched' }

  const sameAmountSameCurrency = candidates.filter(p => {
    if (p.currency !== bankRecord.currency) return false
    return toCents(p.amount) === bankCents
  })

  const bankDay = parseBankDate(bankRecord.valueDate).toISOString().slice(0, 10) // YYYY-MM-DD in UTC
  const heuristic = sameAmountSameCurrency.filter(p => p.createdAt.toISOString().slice(0, 10) === bankDay)

  if (heuristic.length === 1) return { type: 'matched', payment: heuristic[0] }
  return { type: 'unmatched' }
}
  
  // ─── Main export ─────────────────────────────────────────────────────────────
  
  export async function reconcilePayments(
    bankData: BankRecord[],
    periodStart: Date,
    periodEnd: Date,
  ): Promise<ReconciliationResult> {
  if (!(periodStart instanceof Date) || Number.isNaN(periodStart.getTime())) {
    throw new Error('Invalid periodStart')
  }
  if (!(periodEnd instanceof Date) || Number.isNaN(periodEnd.getTime())) {
    throw new Error('Invalid periodEnd')
  }
  if (periodStart >= periodEnd) {
    throw new Error('periodStart must be before periodEnd')
  }

  // Concurrency-safety: execute the run inside a single transaction and lock eligible payment rows.
  // This prevents two concurrent reconciliations from "double matching" the same payment rows.
  return await db.transaction(async tx => {
    const baseQuery = tx
      .select()
      .from(payments)
      .where(
        and(
          gte(payments.createdAt, periodStart),
          lt(payments.createdAt, periodEnd),
        ),
      )

    // Drizzle supports row locking in supported dialects (e.g., Postgres) via `.for('update')`.
    // Use it when available to avoid concurrent runs matching the same payment rows.
    const maybeLockedQuery =
      (baseQuery as any).for ? (baseQuery as any).for('update') : baseQuery

    const systemPayments = (await maybeLockedQuery) as Payment[]

    const matched: MatchedPair[] = []
    const discrepancies: Discrepancy[] = []
    const matchedPaymentIds = new Set<string>()
    const matchedBankIds = new Set<string>()

    const bankInPeriod = bankData.filter(r => isInPeriod(parseBankDate(r.valueDate), periodStart, periodEnd))

    for (const bankRecord of bankInPeriod) {
      const remaining = systemPayments.filter(p => !matchedPaymentIds.has(p.id))
      const outcome = resolveMatch(bankRecord, remaining)

      if (outcome.type === 'matched') {
        matched.push({ bankRecord, payment: outcome.payment })
        matchedPaymentIds.add(outcome.payment.id)
        matchedBankIds.add(bankRecord.transactionId)
      } else if (outcome.type === 'discrepancy') {
        discrepancies.push({
          bankRecord,
          payment: outcome.payment,
          amountDelta: outcome.delta,
        })
        matchedBankIds.add(bankRecord.transactionId)
        // Do NOT mark reconciled when there is a discrepancy; it requires review.
      }
    }

    const totalBankCents = bankInPeriod.reduce((sum, r) => sum + toCents(r.amount), 0n)
    const totalSystemCents = systemPayments.reduce((sum, p) => sum + toCents(p.amount), 0n)
    const differenceCents = totalBankCents - totalSystemCents

    const bankOnly = bankInPeriod.filter(r => !matchedBankIds.has(r.transactionId))
    const systemOnly = systemPayments.filter(p => !matchedPaymentIds.has(p.id))

    const [saved] = await tx
      .insert(reconciliations)
      .values({
        periodStart,
        periodEnd,
        matchedCount: matched.length,
        unmatchedCount: bankOnly.length + systemOnly.length,
        totalBankAmount: fromCents(totalBankCents),
        totalSystemAmount: fromCents(totalSystemCents),
        difference: fromCents(differenceCents),
        status: 'complete',
      })
      .returning()

    if (matchedPaymentIds.size > 0) {
      const ids = [...matchedPaymentIds]
      await tx
        .update(payments)
        .set({ status: 'reconciled' })
        .where(
          and(
            inArray(payments.id, ids),
            // Only reconcile eligible rows; prevents double-marking if a concurrent run wins the race.
            eq(payments.status, 'cleared'),
          ),
        )
    }

    return {
      id: saved.id,
      matched,
      unmatched: { bankOnly, systemOnly },
      discrepancies,
      summary: {
        totalBankAmount: fromCents(totalBankCents),
        totalSystemAmount: fromCents(totalSystemCents),
        difference: fromCents(differenceCents),
      },
    }
  })
}