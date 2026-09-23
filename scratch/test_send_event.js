async function main() {
  const payload = {
    eventType: "product_added_to_cart",
    timestamp: new Date().toISOString(),
    clientId: "test_client_manual",
    shopDomain: "cartmend.myshopify.com",
    page: "https://cartmend.myshopify.com/products/shirt",
    productId: "8740119969975",
    metadata: {
      url: "https://cartmend.myshopify.com/products/shirt",
      productId: "8740119969975",
      quantity: 1,
    }
  };

  const res = await fetch("https://traffiq-smoky.vercel.app/api/events?shop=cartmend.myshopify.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  console.log("Status:", res.status);
  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));
}

main();
