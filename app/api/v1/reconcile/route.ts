import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { reconcilePayments, BankRecord } from '@/lib/services/reconciliation/reconciler'
import { reconciliations } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { getSession } from '@/lib/auth'

const ReconcileRequestSchema = z.object({
  bankData: z.array(
    z.object({
      transactionId: z.string(),
      amount: z.number(),
      currency: z.literal('USD'),
      valueDate: z.string().datetime(),
      description: z.string(),
      reference: z.string(),
    }),
  ),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  notes: z.string().optional(),
}).refine(
  (v) => new Date(v.periodStart) < new Date(v.periodEnd),
  { message: 'periodStart must be before periodEnd', path: ['periodEnd'] },
)

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const parsed = ReconcileRequestSchema.parse(body)

    const result = await reconcilePayments(
      parsed.bankData as BankRecord[],
      new Date(parsed.periodStart),
      new Date(parsed.periodEnd),
    )

    return NextResponse.json({ run: result }, { status: 201 })
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (id) {
    const run = await db.query.reconciliations.findFirst({
      where: eq(reconciliations.id, id),
    })
    if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ run }, { status: 200 })
  }

  const runs = await db
    .select()
    .from(reconciliations)
    .orderBy(desc(reconciliations.periodEnd))
    .limit(50)

  return NextResponse.json({ runs }, { status: 200 })
}