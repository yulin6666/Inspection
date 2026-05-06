import jwt from 'jsonwebtoken'
import crypto from 'crypto'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key'

export interface JWTPayload {
  userId: number
  companyId: number
  role: string
  storeId?: number
}

// access token：15 分钟有效
export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' })
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload
}

// refresh token：随机字符串，有效期 7 天
export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex')
}

export function refreshTokenExpiresAt(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d
}
