import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/jwt'

// POST /api/auth/refresh — exchange refresh token for new access token
export async function POST(req: NextRequest) {
  try {
    const { refreshToken } = await req.json()
    if (!refreshToken) {
      return NextResponse.json({ error: 'Missing refresh token' }, { status: 400 })
    }

    // query database
    const record = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    })

    // not found or expired
    if (!record || record.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Refresh token is invalid or expired' }, { status: 401 })
    }

    // issue new access token
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
