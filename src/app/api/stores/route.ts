import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/middleware/auth'

// GET /api/stores - get store list
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  const stores = await prisma.store.findMany({
    where: { companyId: auth.companyId },
    select: {
      id: true,
      name: true,
      region: true,
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ stores })
}
