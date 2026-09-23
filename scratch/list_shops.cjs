const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.shop.findMany().then(shops => {
  console.log(shops.map(s => ({ id: s.id, domain: s.shopDomain, status: s.status, createdAt: s.createdAt })));
}).finally(() => prisma.$disconnect());
