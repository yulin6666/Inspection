import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/middleware/auth'
import { Prisma } from '@prisma/client'

// GET /api/tasks/:id - 任务详情
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth(req)
  if (authResult instanceof NextResponse) return authResult
  const { companyId } = authResult

  const { id } = await params
  const taskId = parseInt(id)
  if (isNaN(taskId)) return NextResponse.json({ error: '无效的任务ID' }, { status: 400 })

  const task = await prisma.inspectionTask.findFirst({
    where: { id: taskId, companyId },
    include: {
      store: true,
      assignee: { select: { id: true, email: true, role: true, name: true } },
      creator: { select: { id: true, email: true, role: true, name: true } },
      inspectionItems: true,
      rectificationSubmissions: {
        orderBy: { submittedAt: 'desc' },
        include: {
          submitter: { select: { id: true, email: true } },
          attachments: true,
        },
      },
    },
  })

  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  return NextResponse.json(task)
}

// DELETE /api/tasks/:id - 删除任务（仅 hq_admin）
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth(req)
  if (authResult instanceof NextResponse) return authResult

  // 检查权限
  if (authResult.role !== 'hq_admin') {
    return NextResponse.json({ error: '权限不足' }, { status: 403 })
  }

  const { userId, companyId } = authResult

  const { id } = await params
  const taskId = parseInt(id)
  if (isNaN(taskId)) return NextResponse.json({ error: '无效的任务ID' }, { status: 400 })

  const task = await prisma.inspectionTask.findFirst({
    where: { id: taskId, companyId },
  })
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  await prisma.$transaction([
    prisma.auditLog.create({
      data: {
        companyId,
        entityType: 'inspection_task',
        entityId: taskId,
        action: 'DELETE',
        beforeJson: JSON.stringify(task),
        operatorId: userId,
      },
    }),
    prisma.inspectionTask.delete({ where: { id: taskId } }),
  ])

  return NextResponse.json({ message: '删除成功' })
}
