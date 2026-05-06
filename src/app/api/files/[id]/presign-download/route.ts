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

  const attachment = await prisma.attachment.findFirst({
    where: { id: parseInt(params.id), companyId: auth.companyId },
  })

  if (!attachment) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 })
  }

  // 生成预签名下载 URL（5分钟有效）
  const downloadUrl = await getPresignedDownloadUrl(attachment.s3Key, 300)

  return NextResponse.json({ downloadUrl, fileName: attachment.fileName })
}
