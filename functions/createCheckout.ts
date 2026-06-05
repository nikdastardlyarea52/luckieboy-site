export default async function handler(req: Request): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const SITE_URL = "https://base44.app/api/apps/6a0421bfc04dc7179e198e72/files/mp/public/6a0421bfc04dc7179e198e72/9a44d4f7c_index.html";

  const body = await req.json();
  const { type, tier, productName, price } = body;

  const params = new URLSearchParams();
  params.set("success_url", SITE_URL + "?payment=success");
  params.set("cancel_url", SITE_URL + "?payment=cancelled");
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");

  if (type === "membership") {
    const names: Record<string, string> = {
      fan: "Luckie Fan Membership",
      superfan: "Luckie Super Fan Membership",
    };
    const amounts: Record<string, string> = { fan: "499", superfan: "999" };
    params.set("mode", "subscription");
    params.set("line_items[0][price_data][product_data][name]", names[tier] || "Luckie Membership");
    params.set("line_items[0][price_data][unit_amount]", amounts[tier] || "499");
    params.set("line_items[0][price_data][recurring][interval]", "month");
  } else {
    params.set("mode", "payment");
    params.set("line_items[0][price_data][product_data][name]", productName);
    params.set("line_items[0][price_data][unit_amount]", String(Math.round(price * 100)));
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await res.json();

  return new Response(JSON.stringify(res.ok ? { url: data.url } : { error: data.error?.message }), {
    status: res.ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
