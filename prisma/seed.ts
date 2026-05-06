import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('开始初始化测试数据...')

  // 创建企业
  const company = await prisma.company.upsert({
    where: { id: 1 },
    update: {},
    create: { name: '测试连锁企业' },
  })
  console.log('✓ 企业创建完成:', company.name)

  // 创建门店
  const stores = await Promise.all([
    prisma.store.upsert({
      where: { id: 1 },
      update: {},
      create: { companyId: company.id, name: '北京朝阳店', region: '华北区' },
    }),
    prisma.store.upsert({
      where: { id: 2 },
      update: {},
      create: { companyId: company.id, name: '上海浦东店', region: '华东区' },
    }),
  ])
  console.log('✓ 门店创建完成:', stores.map(s => s.name).join(', '))

  // 创建用户
  const passwordHash = await bcrypt.hash('password123', 10)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: {},
    create: {
      companyId: company.id,
      email: 'admin@test.com',
      passwordHash,
      name: '总部管理员',
      role: 'hq_admin',
    },
  })

  const inspector = await prisma.user.upsert({
    where: { email: 'inspector@test.com' },
    update: {},
    create: {
      companyId: company.id,
      email: 'inspector@test.com',
      passwordHash,
      name: '巡检员',
      role: 'inspector',
    },
  })

  const storeManager = await prisma.user.upsert({
    where: { email: 'manager@test.com' },
    update: {},
    create: {
      companyId: company.id,
      storeId: stores[0].id,
      email: 'manager@test.com',
      passwordHash,
      name: '门店负责人',
      role: 'store_manager',
    },
  })

  console.log('✓ 用户创建完成:')
  console.log('  - HQ Admin:', admin.email)
  console.log('  - Inspector:', inspector.email)
  console.log('  - Store Manager:', storeManager.email)
  console.log('  - 密码统一: password123')

  // 创建一个示例巡检任务
  const task = await prisma.inspectionTask.create({
    data: {
      companyId: company.id,
      storeId: stores[0].id,
      title: '2024年1月例行巡检',
      description: '检查门店卫生、陈列规范、设备运行情况',
      assigneeId: inspector.id,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7天后
      status: 'PENDING_INSPECTION',
      createdBy: admin.id,
      inspectionItems: {
        create: [
          { itemName: '收银台卫生达标' },
          { itemName: '商品陈列符合标准' },
          { itemName: '冷链设备温度正常' },
          { itemName: '员工着装规范' },
          { itemName: '消防通道畅通' },
        ],
      },
    },
  })

  console.log('✓ 示例任务创建完成:', task.title)
  console.log('\n初始化完成！')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
