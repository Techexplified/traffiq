async function inspectPage() {
  const res = await fetch("https://cartmend.myshopify.com/collections/all");
  const html = await res.text();
  console.log("Status:", res.status);
  console.log("Redirected?", res.redirected, res.url);
  console.log("HTML snippet:\n", html.slice(0, 1000));
}

inspectPage().catch(console.error);
