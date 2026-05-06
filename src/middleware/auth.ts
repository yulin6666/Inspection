import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, JWTPayload } from '@/lib/jwt'

/**
 * 从请求中提取并验证 JWT，返回 payload 或 401 Response
 */
export async function requireAuth(req: NextRequest): Promise<JWTPayload | NextResponse> {
  const authHeader = req.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Missing or invalid authorization header' },
      { status: 401 }
    )
  }

  try {
    const token = authHeader.substring(7)
    return verifyToken(token)
  } catch {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    )
  }
}

/**
 * 检查用户角色，不满足时返回 403 Response，满足时返回 null
 */
export function requireRoles(roles: string[]) {
  return (user: JWTPayload): NextResponse | null => {
    if (!roles.includes(user.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }
    return null
  }
}
