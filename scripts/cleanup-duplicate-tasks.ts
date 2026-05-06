import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function cleanup() {
  console.log('🔍 Checking for duplicate tasks...')

  // Find all tasks with the same title
  const duplicates = await prisma.inspectionTask.findMany({
    where: {
      title: 'January 2024 Routine Inspection'
    },
    orderBy: { id: 'asc' }
  })

  console.log(`Found ${duplicates.length} tasks with title "January 2024 Routine Inspection"`)

  if (duplicates.length <= 1) {
    console.log('✓ No duplicates found, database is clean!')
    await prisma.$disconnect()
    return
  }

  // Keep the first one, delete the rest
  const toKeep = duplicates[0]
  const toDelete = duplicates.slice(1)

  console.log(`\n📌 Keeping task ID: ${toKeep.id}`)
  console.log(`🗑️  Deleting ${toDelete.length} duplicate task(s): ${toDelete.map(t => t.id).join(', ')}`)

  for (const task of toDelete) {
    await prisma.inspectionTask.delete({ where: { id: task.id } })
    console.log(`  ✓ Deleted task ID: ${task.id}`)
  }

  console.log('\n✅ Cleanup complete!')
  await prisma.$disconnect()
}

cleanup()
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
