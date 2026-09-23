import { loader } from '../app/routes/api.protection.status.tsx';
import prisma from '../app/db.server.js';

async function runTests() {
  console.log("=== TEST 1: Blocked Session Status ===");
  const req1 = new Request("http://localhost/api/protection/status?shop=fitlinetest.myshopify.com&clientId=dd6cca6d-8c60-4fd1-aa98-c467447bfe02");
  const res1 = await loader({ request: req1, params: {}, context: {} } as any);
  const data1 = await res1.json();
  console.log("Status:", res1.status);
  console.log("Response:", JSON.stringify(data1, null, 2));

  console.log("\n=== TEST 2: Safe Shopper Session Status ===");
  const req2 = new Request("http://localhost/api/protection/status?shop=fitlinetest.myshopify.com&clientId=clean_shopper_12345");
  const res2 = await loader({ request: req2, params: {}, context: {} } as any);
  const data2 = await res2.json();
  console.log("Status:", res2.status);
  console.log("Response:", JSON.stringify(data2, null, 2));

  console.log("\n=== TEST 3: Challenge Test Mode (?test_challenge=1) ===");
  const req3 = new Request("http://localhost/api/protection/status?shop=fitlinetest.myshopify.com&clientId=clean_shopper_12345&test_challenge=1");
  const res3 = await loader({ request: req3, params: {}, context: {} } as any);
  const data3 = await res3.json();
  console.log("Status:", res3.status);
  console.log("Response:", JSON.stringify(data3, null, 2));
}

runTests()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
