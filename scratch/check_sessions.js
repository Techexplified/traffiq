import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.session.findMany();
  console.log("Sessions:", sessions.map(s => ({ shop: s.shop, isOnline: s.isOnline, expires: s.expires })));
}

main().finally(() => prisma.$disconnect());
