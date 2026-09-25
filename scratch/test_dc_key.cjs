async function testDcKey() {
  const url = "https://traffiq-smoky.vercel.app/api/protection/status?shop=cartmend.myshopify.com&clientId=dc9afc54-ba6a-437d-8add-79d3fb035710";
  console.log("Checking key: dc9afc54-ba6a-437d-8add-79d3fb035710 on Vercel:");
  const res = await fetch(url);
  const data = await res.json();
  console.log("Status:", res.status);
  console.log("Result:", JSON.stringify(data, null, 2));
}

testDcKey().catch(console.error);
