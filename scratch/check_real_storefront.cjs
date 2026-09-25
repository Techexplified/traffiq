async function checkStoreWithPassword() {
  // 1. Post password to /password
  const formBody = new URLSearchParams();
  formBody.append("form_type", "storefront_password");
  formBody.append("utf8", "✓");
  formBody.append("password", "auvowl");

  const loginRes = await fetch("https://cartmend.myshopify.com/password", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody.toString(),
    redirect: "manual",
  });

  console.log("Login status:", loginRes.status);
  const cookieHeaders = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get("set-cookie")];
  console.log("Cookies received:", cookieHeaders);
  const cookie = cookieHeaders.map(c => (c || "").split(";")[0]).filter(Boolean).join("; ");

  // 2. Fetch /collections/all with cookie
  const pageRes = await fetch("https://cartmend.myshopify.com/collections/all", {
    headers: {
      Cookie: cookie,
    },
    redirect: "follow",
  });

  console.log("Page status:", pageRes.status, "URL:", pageRes.url);
  const html = await pageRes.text();
  console.log("Page HTML length:", html.length);
  console.log("Contains traffiq?", html.includes("traffiq"));
  console.log("Contains traffiq-challenge?", html.includes("traffiq-challenge"));
  console.log("Contains TRAFFIQ_CONFIG?", html.includes("TRAFFIQ_CONFIG"));

  // Check script tags
  const scripts = html.match(/<script[^>]*src="[^"]*"[^>]*>/gi) || [];
  const traffiqScripts = scripts.filter(s => s.includes("traffiq"));
  console.log("Traffiq scripts found:", traffiqScripts);

  if (html.includes("traffiq")) {
    const idx = html.indexOf("traffiq");
    console.log("Context around traffiq:\n", html.slice(Math.max(0, idx - 200), idx + 400));
  }
}

checkStoreWithPassword().catch(console.error);
