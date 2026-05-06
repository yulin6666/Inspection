import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, JWTPayload } from '@/lib/jwt'

/**
 * Extract and verify JWT from request, returns payload or 401 Response
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
 * Check user role, returns 403 Response if not allowed, null if allowed
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
