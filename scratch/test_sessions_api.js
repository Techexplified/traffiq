async function main() {
  const res = await fetch("https://traffiq-smoky.vercel.app/api/traffic/sessions?shop=fitlinetest.myshopify.com&limit=5");
  console.log("Status:", res.status);
  const data = await res.json();
  console.log("Returned sessions count:", data.sessions?.length);
  console.log("First session:", JSON.stringify(data.sessions?.[0], null, 2));
}

main();
