import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/middleware/auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

// 状态机：合法的状态流转
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING_INSPECTION: ['PENDING_RECTIFICATION'],
  PENDING_RECTIFICATION: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['CLOSED', 'PENDING_RECTIFICATION'],
  CLOSED: [],
}

// 各状态允许操作的角色
const STATUS_ROLES: Record<string, string[]> = {
  PENDING_RECTIFICATION: ['hq_admin', 'inspector'],
  PENDING_REVIEW: ['store_manager'],
  CLOSED: ['hq_admin', 'inspector'],
}

const statusSchema = z.object({
  status: z.enum(['PENDING_INSPECTION', 'PENDING_RECTIFICATION', 'PENDING_REVIEW', 'CLOSED']),
  comment: z.string().optional(),
})

// PATCH /api/tasks/:id/status - 状态流转
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
  const taskId = parseInt(params.id)
  if (isNaN(taskId)) {
    return NextResponse.json({ error: '无效的任务 ID' }, { status: 400 })
  }

  const task = await prisma.inspectionTask.findFirst({
    where: { id: taskId, companyId },
  })
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  // 检查状态流转是否合法
  const allowedNext = VALID_TRANSITIONS[task.status] || []
  if (!allowedNext.includes(newStatus)) {
    return NextResponse.json(
      { error: `不允许从 ${task.status} 流转到 ${newStatus}` },
      { status: 422 }
    )
  }

  // 检查角色权限
  const allowedRoles = STATUS_ROLES[newStatus] || []
  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return NextResponse.json(
      { error: '当前角色无权执行此状态变更' },
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
