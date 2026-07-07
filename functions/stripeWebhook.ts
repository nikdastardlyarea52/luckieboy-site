import Stripe from "npm:stripe@14";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY_2") || "";
const PRINTFUL_STORE_ID = "18182792";

// Maps Stripe Payment Link URL suffixes → Printful sync variant IDs
const PAYMENT_LINK_URL_TO_PRINTFUL: Record<string, { sync_variant_id: number; name: string }> = {
  "eVqeVe7280lUftr2OMb3q01": { sync_variant_id: 5311187830, name: "Luckie Classic Tee" },
  "eVq7sM5Y4b0ychfcpmb3q04": { sync_variant_id: 5311189811, name: "Luckie Coffee Mug" },
  "eVq14o86cecK9539dab3q03": { sync_variant_id: 5311188938, name: "Luckie Hoodie" },
  "5kQ00kdqw8Sqa974WUb3q00": { sync_variant_id: 5311188969, name: "Luckie Sticker" },
};

// Maps membership payment link suffixes → tier names
const PAYMENT_LINK_TO_MEMBERSHIP: Record<string, string> = {
  "6oU00kfyE1pYdlj2OMb3q05": "Fan",
  "4gM7sM3PWd8G2GF752b3q06": "Super Fan",
};

async function createPrintfulOrder(
  syncVariantId: number,
  customerName: string,
  email: string,
  address: { line1: string; line2?: string; city: string; state: string; postal_code: string; country: string; }
) {
  const body = {
    recipient: {
      name: customerName,
      email: email,
      address1: address.line1,
      address2: address.line2 || "",
      city: address.city,
      state_code: address.state,
      zip: address.postal_code,
      country_code: address.country || "US",
    },
    items: [{ sync_variant_id: syncVariantId, quantity: 1 }],
  };

  const res = await fetch("https://api.printful.com/orders", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PRINTFUL_API_KEY}`,
      "X-PF-Store-Id": PRINTFUL_STORE_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Printful error: ${JSON.stringify(data)}`);

  // Confirm so it goes into production
  const orderId = data.result.id;
  await fetch(`https://api.printful.com/orders/${orderId}/confirm`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PRINTFUL_API_KEY}`,
      "X-PF-Store-Id": PRINTFUL_STORE_ID,
    },
  });

  return data.result;
}

Deno.serve(async (req: Request) => {
  const base44 = createClientFromRequest(req);

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  let event: any;
  if (STRIPE_WEBHOOK_SECRET && sig) {
    try {
      const stripe = new Stripe(STRIPE_SECRET);
      event = await stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      console.error("Webhook signature failed:", err.message);
      return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }
  } else {
    event = JSON.parse(body);
  }

  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  const session = event.data.object;
  const customerName = session.customer_details?.name || "Customer";
  const email = session.customer_details?.email || "";
  const address = session.customer_details?.address;
  const paymentLinkId: string = session.payment_link || "";

  // 0. Check if this is a donation (created dynamically, not via a static Payment Link)
  if (session.metadata?.type === "donation") {
    try {
      const amount = (session.amount_total || 0) / 100;
      await base44.asServiceRole.entities.Donation.create({
        donor_name: session.metadata?.donor_name || customerName || "Anonymous",
        donor_email: email,
        amount,
        message: session.metadata?.donor_message || "",
        stripe_session_id: session.id,
      });
      console.log(`Donation logged: $${amount} from ${email || "anonymous"}`);
    } catch (err: any) {
      console.error("Donation logging error:", err.message);
    }
    return new Response(JSON.stringify({ received: true, type: "donation" }), { status: 200 });
  }

  // Check if this is a membership subscription
  let membershipTier: string | undefined;
  for (const [suffix, tier] of Object.entries(PAYMENT_LINK_TO_MEMBERSHIP)) {
    if (paymentLinkId.endsWith(suffix)) {
      membershipTier = tier;
      break;
    }
  }

  if (membershipTier) {
    // Create Subscriber record for membership
    try {
      const existing = await base44.asServiceRole.entities.Subscriber.filter({ email });
      if (existing && existing.length > 0) {
        // Update existing subscriber to membership tier
        await base44.asServiceRole.entities.Subscriber.update(existing[0].id, {
          tier: membershipTier,
          active: true,
        });
        console.log(`Updated subscriber ${email} to tier: ${membershipTier}`);
      } else {
        // Create new subscriber
        await base44.asServiceRole.entities.Subscriber.create({
          email,
          name: customerName || email.split("@")[0],
          tier: membershipTier,
          active: true,
          notes: `Stripe subscription via membership purchase`,
        });
        console.log(`Created subscriber ${email} with tier: ${membershipTier}`);
      }
    } catch (err: any) {
      console.error("Subscriber creation error:", err.message);
    }
    return new Response(JSON.stringify({ received: true, membership: membershipTier }), { status: 200 });
  }

  // No address = likely membership, skip Printful
  if (!address) {
    return new Response(JSON.stringify({ received: true, note: "no address" }), { status: 200 });
  }

  // Handle merch orders with Printful
  let product: { sync_variant_id: number; name: string } | undefined;

  for (const [suffix, prod] of Object.entries(PAYMENT_LINK_URL_TO_PRINTFUL)) {
    if (paymentLinkId.endsWith(suffix)) {
      product = prod;
      break;
    }
  }

  // Fallback: match from line items product name
  if (!product && STRIPE_SECRET) {
    try {
      const stripe = new Stripe(STRIPE_SECRET);
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      for (const item of lineItems.data) {
        const desc = (item.description || "").toLowerCase();
        if (desc.includes("tee") || desc.includes("shirt")) product = { sync_variant_id: 5311187830, name: "Luckie Classic Tee" };
        else if (desc.includes("mug")) product = { sync_variant_id: 5311189811, name: "Luckie Coffee Mug" };
        else if (desc.includes("hoodie")) product = { sync_variant_id: 5311188938, name: "Luckie Hoodie" };
        else if (desc.includes("sticker")) product = { sync_variant_id: 5311188969, name: "Luckie Sticker" };
        if (product) break;
      }
    } catch (e) {
      console.error("Line items lookup failed:", e);
    }
  }

  if (!product) {
    console.log("No merch product matched — skipping Printful.");
    return new Response(JSON.stringify({ received: true, note: "unmatched product" }), { status: 200 });
  }

  console.log(`Creating Printful order: ${product.name} for ${customerName}`);

  try {
    const result = await createPrintfulOrder(
      product.sync_variant_id,
      customerName,
      email,
      {
        line1: address.line1 || "",
        line2: address.line2 || "",
        city: address.city || "",
        state: address.state || "",
        postal_code: address.postal_code || "",
        country: address.country || "US",
      }
    );
    console.log("Printful order confirmed:", result.id);
    return new Response(JSON.stringify({ received: true, printful_order_id: result.id }), { status: 200 });
  } catch (err: any) {
    console.error("Printful order error:", err.message);
    return new Response(JSON.stringify({ received: true, error: err.message }), { status: 200 });
  }
});
