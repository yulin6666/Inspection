import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/middleware/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const companyId = auth.companyId

  const [totalTasks, closedTasks, overdueTasks, pendingRectification, pendingReview] =
    await Promise.all([
      prisma.inspectionTask.count({ where: { companyId } }),
      prisma.inspectionTask.count({ where: { companyId, status: 'CLOSED' } }),
      prisma.inspectionTask.count({
        where: { companyId, status: { not: 'CLOSED' }, dueDate: { lt: new Date() } },
      }),
      prisma.inspectionTask.count({ where: { companyId, status: 'PENDING_RECTIFICATION' } }),
      prisma.inspectionTask.count({ where: { companyId, status: 'PENDING_REVIEW' } }),
    ])

  const completionRate = totalTasks > 0 ? Math.round((closedTasks / totalTasks) * 100) : 0
  const overdueRate = totalTasks > 0 ? Math.round((overdueTasks / totalTasks) * 100) : 0

  return NextResponse.json({
    summary: {
      totalTasks,
      closedTasks,
      overdueTasks,
      pendingRectification,
      pendingReview,
      completionRate,
      overdueRate,
    },
  })
}
