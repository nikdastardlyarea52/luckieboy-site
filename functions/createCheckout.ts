import { createClientFromRequest, base44 } from 'npm:@base44/sdk@0.8.25';

const APP_ID = '6a0421bfc04dc7179e198e72';

const TIERS: Record<string, { name: string; price: number; description: string }> = {
  fan: {
    name: "Luckie Fan Membership",
    price: 499,
    description: "Exclusive behind-the-scenes photos, monthly wallpaper pack, early access & more 🐾"
  },
  superfan: {
    name: "Luckie Super Fan Membership",
    price: 999,
    description: "VIP access — video content, custom stickers, Q&A, 10% off merch & annual photo print 👑"
  }
};

const MERCH: Record<string, { name: string; price: number; description: string }> = {
  tee:     { name: "Luckie Classic Tee",  price: 2999, description: "Rock Luckie's face on a soft Bella+Canvas unisex tee. Ships worldwide via Printful." },
  mug:     { name: "Luckie Coffee Mug",   price: 1999, description: "Start every morning with Luckie's face on your mug. White glossy, 11oz." },
  hoodie:  { name: "Luckie Hoodie",       price: 4499, description: "Cozy Gildan hoodie with Luckie on the front." },
  sticker: { name: "Luckie Sticker",      price:  499, description: "Kiss-cut vinyl sticker. Weatherproof. Perfect for laptops, water bottles, anything." },
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  try {
    const client = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { type, id, success_url, cancel_url } = body;

    let item: { name: string; price: number; description: string } | undefined;

    if (type === 'tier') {
      item = TIERS[id];
    } else if (type === 'merch') {
      item = MERCH[id];
    }

    if (!item) {
      return Response.json({ error: `Unknown item: ${type}/${id}` }, { status: 400 });
    }

    const session = await client.payments.createCheckoutSession({
      line_items: [{
        name: item.name,
        description: item.description,
        amount: item.price,
        quantity: 1,
      }],
      success_url: success_url || `https://base44.app/api/apps/${APP_ID}/files/mp/public/${APP_ID}/d3e052709_index.html?payment=success`,
      cancel_url: cancel_url || `https://base44.app/api/apps/${APP_ID}/files/mp/public/${APP_ID}/d3e052709_index.html?payment=cancelled`,
      metadata: { type, id }
    });

    return Response.json(
      { url: session.url },
      { headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (error) {
    console.error('Checkout error:', error);
    return Response.json(
      { error: error.message },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
});
