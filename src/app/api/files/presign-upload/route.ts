import { NextRequest, NextResponse } from 'next/server'
import { getPresignedUploadUrl } from '@/lib/s3-helpers'
import { requireAuth } from '@/middleware/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  taskId: z.number(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().max(10 * 1024 * 1024), // max 10MB
})

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  try {
    const body = await req.json()
    const { taskId, fileName, mimeType, size } = schema.parse(body)

    // verify task exists and belongs to same company
    const task = await prisma.inspectionTask.findFirst({
      where: { id: taskId, companyId: auth.companyId },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // generate S3 key
    const ext = fileName.split('.').pop()
    const s3Key = `company/${auth.companyId}/task/${taskId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    // get presigned upload URL (valid for 5 minutes)
    const uploadUrl = await getPresignedUploadUrl(s3Key, mimeType, 300)

    // pre-create attachment record (confirmed by frontend after upload)
    const attachment = await prisma.attachment.create({
      data: {
        companyId: auth.companyId,
        taskId,
        s3Key,
        fileName,
        mimeType,
        size,
      },
    })

    return NextResponse.json({ uploadUrl, attachmentId: attachment.id, s3Key })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    console.error('presign-upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
