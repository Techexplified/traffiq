async function checkHtml() {
  const res = await fetch("https://cartmend.myshopify.com/collections/all");
  const html = await res.text();
  console.log("HTML length:", html.length);
  console.log("Contains traffiq?", html.includes("traffiq"));
  console.log("Contains traffiq-challenge?", html.includes("traffiq-challenge"));
  console.log("Contains TRAFFIQ_CONFIG?", html.includes("TRAFFIQ_CONFIG"));

  // Check any script tags that contain "traffiq" or "challenge"
  const matches = html.match(/<script[^>]*src="[^"]*"[^>]*>/gi) || [];
  console.log("Total script tags with src:", matches.length);
  const relevant = matches.filter(s => s.toLowerCase().includes("traffiq") || s.toLowerCase().includes("challenge"));
  console.log("Relevant script tags:", relevant);
}

checkHtml().catch(console.error);
