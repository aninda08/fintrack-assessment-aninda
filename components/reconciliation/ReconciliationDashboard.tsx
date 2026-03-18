'use client'

import React, { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface ReconciliationRun {
  id: string
  periodStart: string
  periodEnd: string
  matchedCount: number
  unmatchedCount: number
  difference: number
  status: 'pending' | 'running' | 'complete' | 'failed'
  createdAt?: string
}

export function ReconciliationDashboard() {
  const [runs, setRuns] = useState<ReconciliationRun[]>([])

  useEffect(() => {
    let mounted = true

    const fetchRuns = async () => {
      try {
        const res = await fetch('/api/v1/reconcile')
        if (!res.ok) return
        const data = await res.json()
        if (!mounted) return
        setRuns(data.runs ?? [])
      } catch {
        // silent
      }
    }

    fetchRuns()
    const interval = setInterval(fetchRuns, 3000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  const formatAmount = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0))
  const runsThisMonth = runs.filter((r) => {
    const d = r.createdAt ? new Date(r.createdAt) : new Date(r.periodEnd)
    return Number.isFinite(d.getTime()) && d >= monthStart && d <= now
  })
  const totalDiscrepancyAmount = runs.reduce((sum, r) => sum + (r.difference ?? 0), 0)

  const badgeClass: Record<ReconciliationRun['status'], string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    complete: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  }

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 items-start">
            <div>
              <div className="text-sm text-muted-foreground">Total runs this month</div>
              <div className="text-2xl font-semibold">{runsThisMonth.length}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Total discrepancy amount</div>
              <div className="text-2xl font-semibold">{formatAmount(totalDiscrepancyAmount)}</div>
            </div>
            <div className="flex sm:justify-end">
              <button
                type="button"
                disabled
                title="Triggering a new reconciliation run is not implemented in this assessment."
                className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white opacity-50 cursor-not-allowed"
              >
                Trigger New Reconciliation
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reconciliation Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Matched</TableHead>
                <TableHead>Unmatched</TableHead>
                <TableHead>Discrepancy</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map(run => (
                <TableRow key={run.id}>
                  <TableCell>
                    {run.periodStart} – {run.periodEnd}
                  </TableCell>
                  <TableCell>{run.matchedCount}</TableCell>
                  <TableCell>{run.unmatchedCount}</TableCell>
                  <TableCell>{formatAmount(run.difference)}</TableCell>
                  <TableCell>
                    <Badge className={badgeClass[run.status]}>{run.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}