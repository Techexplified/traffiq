async function testLiveVercel() {
  const url = "https://traffiq-smoky.vercel.app/api/protection/status?shop=cartmend.myshopify.com&clientId=30970b12-b76f-4ea5-a0e1-078d3f105236";
  console.log("Fetching live Vercel URL:", url);
  const res = await fetch(url);
  const data = await res.json();
  console.log("Live Vercel status:", res.status);
  console.log("Live Vercel data:", JSON.stringify(data, null, 2));
}

testLiveVercel().catch(console.error);
