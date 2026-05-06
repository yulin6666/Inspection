import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireRoles } from '@/middleware/auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

const createTaskSchema = z.object({
  storeId: z.number(),
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.number(),
  dueDate: z.string(),
  items: z.array(z.object({
    itemName: z.string().min(1),
  })).min(1),
})

// GET /api/tasks - 任务列表
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof NextResponse) return authResult
  const user = authResult

  const { searchParams } = new URL(req.url)
  const storeId = searchParams.get('storeId')
  const status = searchParams.get('status')
  const assigneeId = searchParams.get('assigneeId')
  const overdue = searchParams.get('overdue')

  const where: Record<string, unknown> = { companyId: user.companyId }

  // 门店负责人只能看自己门店的任务
  if (user.role === 'store_manager' && user.storeId) {
    where.storeId = user.storeId
  } else if (storeId) {
    where.storeId = storeId
  }

  if (status) where.status = status
  if (assigneeId) where.assigneeId = assigneeId
  if (overdue === 'true') {
    where.dueDate = { lt: new Date() }
    where.status = { not: 'CLOSED' }
  }

  const tasks = await prisma.inspectionTask.findMany({
    where,
    include: {
      store: { select: { id: true, name: true, region: true } },
      assignee: { select: { id: true, email: true, name: true } },
      creator: { select: { id: true, email: true, name: true } },
      _count: { select: { inspectionItems: true, rectificationSubmissions: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ tasks })
}

// POST /api/tasks - 创建任务（hq_admin / inspector）
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof NextResponse) return authResult
  const user = authResult

  const roleCheck = requireRoles(['hq_admin', 'inspector'])(user)
  if (roleCheck) return roleCheck

  const body = await req.json()
  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { storeId, title, description, assigneeId, dueDate, items } = parsed.data

  // 验证门店属于同一公司
  const store = await prisma.store.findFirst({
    where: { id: storeId, companyId: user.companyId },
  })
  if (!store) {
    return NextResponse.json({ error: '门店不存在' }, { status: 404 })
  }

  const task = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const newTask = await tx.inspectionTask.create({
      data: {
        companyId: user.companyId,
        storeId,
        title,
        description,
        assigneeId,
        dueDate: new Date(dueDate),
        status: 'PENDING_INSPECTION',
        createdBy: user.userId,
        inspectionItems: {
          create: items.map((item) => ({ itemName: item.itemName })),
        },
      },
      include: {
        store: true,
        assignee: { select: { id: true, email: true, name: true } },
        inspectionItems: true,
      },
    })

    // 写审计日志
    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        entityType: 'inspection_task',
        entityId: newTask.id,
        action: 'CREATE',
        afterJson: JSON.stringify(newTask),
        operatorId: user.userId,
      },
    })

    return newTask
  })

  return NextResponse.json({ task }, { status: 201 })
}
