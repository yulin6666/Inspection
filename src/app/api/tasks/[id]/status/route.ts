import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/middleware/auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

// state machine: valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING_INSPECTION: ['PENDING_RECTIFICATION'],
  PENDING_RECTIFICATION: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['CLOSED', 'PENDING_RECTIFICATION'],
  CLOSED: [],
}

// roles allowed to perform each status transition
const STATUS_ROLES: Record<string, string[]> = {
  PENDING_RECTIFICATION: ['hq_admin', 'inspector'],
  PENDING_REVIEW: ['store_manager'],
  CLOSED: ['hq_admin', 'inspector'],
}

const statusSchema = z.object({
  status: z.enum(['PENDING_INSPECTION', 'PENDING_RECTIFICATION', 'PENDING_REVIEW', 'CLOSED']),
  comment: z.string().optional(),
})

// PATCH /api/tasks/:id/status - status transition
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req)
  if (authResult instanceof NextResponse) return authResult
  const { userId, companyId, role } = authResult

  const body = await req.json()
  const parsed = statusSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { status: newStatus } = parsed.data
  const { id } = await params
  const taskId = parseInt(id)
  if (isNaN(taskId)) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }

  const task = await prisma.inspectionTask.findFirst({
    where: { id: taskId, companyId },
  })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  // check if status transition is valid
  const allowedNext = VALID_TRANSITIONS[task.status] || []
  if (!allowedNext.includes(newStatus)) {
    return NextResponse.json(
      { error: `Transition from ${task.status} to ${newStatus} is not allowed` },
      { status: 422 }
    )
  }

  // check role permission
  const allowedRoles = STATUS_ROLES[newStatus] || []
  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return NextResponse.json(
      { error: 'Your role is not permitted to perform this status change' },
      { status: 403 }
    )
  }

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updatedTask = await tx.inspectionTask.update({
      where: { id: taskId },
      data: { status: newStatus },
    })

    await tx.auditLog.create({
      data: {
        companyId,
        entityType: 'inspection_task',
        entityId: taskId,
        action: 'STATUS_CHANGE',
        beforeJson: JSON.stringify({ status: task.status }),
        afterJson: JSON.stringify({ status: newStatus }),
        operatorId: userId,
      },
    })

    return updatedTask
  })

  return NextResponse.json({ task: updated })
}
