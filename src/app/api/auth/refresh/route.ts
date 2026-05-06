import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/jwt'

// POST /api/auth/refresh — 用 refresh token 换新 access token
export async function POST(req: NextRequest) {
  try {
    const { refreshToken } = await req.json()
    if (!refreshToken) {
      return NextResponse.json({ error: '缺少 refresh token' }, { status: 400 })
    }

    // 查数据库
    const record = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    })

    // 不存在或已过期
    if (!record || record.expiresAt < new Date()) {
      return NextResponse.json({ error: 'refresh token 无效或已过期' }, { status: 401 })
    }

    // 签发新 access token
    const accessToken = signToken({
      userId: record.user.id,
      companyId: record.user.companyId,
      role: record.user.role,
      storeId: record.user.storeId || undefined,
    })

    return NextResponse.json({ accessToken })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
