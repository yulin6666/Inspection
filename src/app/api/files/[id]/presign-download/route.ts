import { NextRequest, NextResponse } from 'next/server'
import { getPresignedDownloadUrl } from '@/lib/s3-helpers'
import { requireAuth } from '@/middleware/auth'
import { prisma } from '@/lib/prisma'

// GET /api/files/:id/presign-download
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const attachment = await prisma.attachment.findFirst({
    where: { id: parseInt(id), companyId: auth.companyId },
  })

  if (!attachment) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // generate presigned download URL (valid for 5 minutes)
  const downloadUrl = await getPresignedDownloadUrl(attachment.s3Key, 300)

  return NextResponse.json({ downloadUrl, fileName: attachment.fileName })
}
