import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { signToken } from '@/lib/jwt'
import { z } from 'zod'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  companyName: z.string().min(1),
  role: z.enum(['hq_admin', 'inspector', 'store_manager']),
  storeId: z.number().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = registerSchema.parse(body)

    // 检查邮箱是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 400 }
      )
    }

    // 创建或查找公司
    let company = await prisma.company.findFirst({
      where: { name: data.companyName },
    })

    if (!company) {
      company = await prisma.company.create({
        data: { name: data.companyName },
      })
    }

    // 哈希密码
    const passwordHash = await bcrypt.hash(data.password, 10)

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        role: data.role,
        companyId: company.id,
        storeId: data.storeId,
      },
    })

    // 生成 JWT
    const token = signToken({
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      storeId: user.storeId || undefined,
    })

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
        storeId: user.storeId,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Register error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
