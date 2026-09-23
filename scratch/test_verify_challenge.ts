import { action as verifyAction } from '../app/routes/api.protection.verify-challenge.tsx';
import prisma from '../app/db.server.js';

async function testVerify() {
  const req = new Request("http://localhost/api/protection/verify-challenge?shop=fitlinetest.myshopify.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shopDomain: "fitlinetest.myshopify.com",
      clientId: "visitor_just_browsing_1790169141999",
      sessionKey: "visitor_just_browsing_1790169141999",
      answer: "slider_verified",
      timestamp: Date.now()
    })
  });

  const res = await verifyAction({ request: req, params: {}, context: {} } as any);
  const data = await res.json();
  console.log("Verify Status:", res.status);
  console.log("Verify Response:", JSON.stringify(data, null, 2));

  const verifiedAction = await prisma.protectionAction.findFirst({
    where: {
      action: "CHALLENGE",
      status: "VERIFIED",
    },
    orderBy: { createdAt: "desc" }
  });
  console.log("Verified Action in DB:", verifiedAction?.id, verifiedAction?.reason);
}

testVerify()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
