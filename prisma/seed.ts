import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Initializing seed data...')

  // create company
  const company = await prisma.company.upsert({
    where: { id: 1 },
    update: { name: 'Test Chain Company' },
    create: { name: 'Test Chain Company' },
  })
  console.log('✓ Company created:', company.name)

  // create stores
  const stores = await Promise.all([
    prisma.store.upsert({
      where: { id: 1 },
      update: { name: 'Beijing Chaoyang Store', region: 'North China' },
      create: { companyId: company.id, name: 'Beijing Chaoyang Store', region: 'North China' },
    }),
    prisma.store.upsert({
      where: { id: 2 },
      update: { name: 'Shanghai Pudong Store', region: 'East China' },
      create: { companyId: company.id, name: 'Shanghai Pudong Store', region: 'East China' },
    }),
  ])
  console.log('✓ Stores created:', stores.map(s => s.name).join(', '))

  // create users
  const passwordHash = await bcrypt.hash('password123', 10)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: { name: 'HQ Admin' },
    create: {
      companyId: company.id,
      email: 'admin@test.com',
      passwordHash,
      name: 'HQ Admin',
      role: 'hq_admin',
    },
  })

  const inspector = await prisma.user.upsert({
    where: { email: 'inspector@test.com' },
    update: { name: 'Inspector' },
    create: {
      companyId: company.id,
      email: 'inspector@test.com',
      passwordHash,
      name: 'Inspector',
      role: 'inspector',
    },
  })

  const storeManager = await prisma.user.upsert({
    where: { email: 'manager@test.com' },
    update: { name: 'Store Manager' },
    create: {
      companyId: company.id,
      storeId: stores[0].id,
      email: 'manager@test.com',
      passwordHash,
      name: 'Store Manager',
      role: 'store_manager',
    },
  })

  console.log('✓ Users created:')
  console.log('  - HQ Admin:', admin.email)
  console.log('  - Inspector:', inspector.email)
  console.log('  - Store Manager:', storeManager.email)
  console.log('  - Password for all: password123')

  // create a sample inspection task
  const task = await prisma.inspectionTask.create({
    data: {
      companyId: company.id,
      storeId: stores[0].id,
      title: 'January 2024 Routine Inspection',
      description: 'Check store hygiene, display standards, and equipment operation',
      assigneeId: inspector.id,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      status: 'PENDING_INSPECTION',
      createdBy: admin.id,
      inspectionItems: {
        create: [
          { itemName: 'Checkout counter hygiene meets standards' },
          { itemName: 'Product display complies with guidelines' },
          { itemName: 'Cold chain equipment temperature normal' },
          { itemName: 'Staff dress code compliance' },
          { itemName: 'Fire exit clear and accessible' },
        ],
      },
    },
  })

  console.log('✓ Sample task created:', task.title)
  console.log('\nSeed complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
