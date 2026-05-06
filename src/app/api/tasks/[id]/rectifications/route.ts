import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/middleware/auth'
import { Prisma } from '@prisma/client'

// POST /api/tasks/:id/rectifications - submit rectification
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  // only store_manager can submit rectifications
  if (auth.role !== 'store_manager') {
    return NextResponse.json({ error: 'Permission denied: only store managers can submit rectifications' }, { status: 403 })
  }

  const { id } = await params
  const taskId = parseInt(id)
  const task = await prisma.inspectionTask.findFirst({
    where: { id: taskId, companyId: auth.companyId },
  })

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (task.status !== 'PENDING_RECTIFICATION') {
    return NextResponse.json({ error: `Current status ${task.status} does not allow rectification submission` }, { status: 400 })
  }

  const body = await req.json()
  const { note, s3Keys } = body // s3Keys: array of uploaded file keys

  const submission = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const sub = await tx.rectificationSubmission.create({
      data: {
        taskId,
        submitterId: auth.userId,
        note: note || '',
      },
    })

    if (s3Keys && s3Keys.length > 0) {
      await tx.attachment.createMany({
        data: s3Keys.map((key: string) => ({
          companyId: auth.companyId,
          taskId,
          submissionId: sub.id,
          s3Key: key,
          fileName: key.split('/').pop() || key,
          mimeType: 'image/jpeg',
          size: 0,
        })),
      })
    }

    await tx.inspectionTask.update({
      where: { id: taskId },
      data: { status: 'PENDING_REVIEW' },
    })

    await tx.auditLog.create({
      data: {
        companyId: auth.companyId,
        entityType: 'inspection_task',
        entityId: taskId,
        action: 'STATUS_CHANGED',
        beforeJson: { status: 'PENDING_RECTIFICATION' },
        afterJson: { status: 'PENDING_REVIEW' },
        operatorId: auth.userId,
      },
    })

    return sub
  })

  return NextResponse.json({ submission }, { status: 201 })
}

// GET /api/tasks/:id/rectifications - view rectification records
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const taskId = parseInt(id)
  const task = await prisma.inspectionTask.findFirst({
    where: { id: taskId, companyId: auth.companyId },
  })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const submissions = await prisma.rectificationSubmission.findMany({
    where: { taskId },
    include: {
      attachments: true,
      submitter: { select: { id: true, email: true, role: true } },
    },
    orderBy: { submittedAt: 'desc' },
  })

  return NextResponse.json({ submissions })
}
