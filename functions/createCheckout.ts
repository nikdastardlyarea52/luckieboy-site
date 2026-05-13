import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { tier } = body;

    if (!tier || !TIERS[tier]) {
      return Response.json({ error: 'Invalid tier. Use "fan" or "superfan".' }, { status: 400 });
    }

    const tierInfo = TIERS[tier];

    const session = await base44.payments.checkout({
      items: [{
        name: tierInfo.name,
        description: tierInfo.description,
        price: tierInfo.price,
        quantity: 1,
      }],
      metadata: { tier }
    });

    return Response.json({ url: session.url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
