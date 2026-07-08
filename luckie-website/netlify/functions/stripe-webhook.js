// Native Stripe webhook handler — replaces the old Base44 function.
// Verifies Stripe's signature using Node's built-in crypto (no stripe SDK needed),
// then handles donations, membership signups, and merch orders (with Printful fulfillment).
const crypto = require('crypto');
const { upsertSubscriber, createDonationRecord } = require('./_blobs');
const { sendMail, GMAIL_USER } = require('./_email');

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY_2 || process.env.PRINTFUL_API_KEY || '';
const PRINTFUL_STORE_ID = '18182792';

const PAYMENT_LINK_URL_TO_PRINTFUL = {
  eVqeVe7280lUftr2OMb3q01: { sync_variant_id: 5311187830, name: 'Luckie Classic Tee' },
  eVq7sM5Y4b0ychfcpmb3q04: { sync_variant_id: 5311189811, name: 'Luckie Coffee Mug' },
  eVq14o86cecK9539dab3q03: { sync_variant_id: 5311188938, name: 'Luckie Hoodie' },
  '5kQ00kdqw8Sqa974WUb3q00': { sync_variant_id: 5311188969, name: 'Luckie Sticker' },
};

const PAYMENT_LINK_TO_MEMBERSHIP = {
  '6oU00kfyE1pYdlj2OMb3q05': 'Fan',
  '4gM7sM3PWd8G2GF752b3q06': 'Super Fan',
};

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) throw new Error('Missing stripe-signature header');
  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) throw new Error('Malformed stripe-signature header');

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Signature mismatch');
  }
  // Reject if timestamp is more than 5 minutes old (replay protection)
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error('Timestamp too old');
}

async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
  });
  return res.json();
}

async function createPrintfulOrder(syncVariantId, customerName, email, address) {
  const body = {
    recipient: {
      name: customerName,
      email,
      address1: address.line1,
      address2: address.line2 || '',
      city: address.city,
      state_code: address.state,
      zip: address.postal_code,
      country_code: address.country || 'US',
    },
    items: [{ sync_variant_id: syncVariantId, quantity: 1 }],
  };

  const res = await fetch('https://api.printful.com/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PRINTFUL_API_KEY}`,
      'X-PF-Store-Id': PRINTFUL_STORE_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Printful error: ${JSON.stringify(data)}`);

  const orderId = data.result.id;
  await fetch(`https://api.printful.com/orders/${orderId}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}`, 'X-PF-Store-Id': PRINTFUL_STORE_ID },
  });

  return data.result;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';

  let stripeEvent;
  try {
    if (STRIPE_WEBHOOK_SECRET && sig) {
      verifyStripeSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    }
    stripeEvent = JSON.parse(rawBody);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const session = stripeEvent.data.object;
  const customerName = session.customer_details?.name || 'Customer';
  const email = session.customer_details?.email || '';
  const address = session.customer_details?.address;
  const paymentLinkId = session.payment_link || '';

  // Donations (dynamic Checkout Session, not a static Payment Link)
  if (session.metadata?.type === 'donation') {
    try {
      const amount = (session.amount_total || 0) / 100;
      const donorName = session.metadata?.donor_name || customerName || 'Anonymous';
      const donorMessage = session.metadata?.donor_message || '';

      await createDonationRecord({
        donor_name: donorName,
        donor_email: email,
        amount,
        message: donorMessage,
        stripe_session_id: session.id,
      });

      if (email) {
        sendMail({
          to: email,
          subject: 'Thank you for supporting Luckie! 🐾',
          html: `<p>Hi ${donorName},</p><p>Thank you so much for your $${amount.toFixed(2)} donation to Luckie's cause — it truly means the world 🐶❤️</p><p>— Luckie & Nicholas</p>`,
        }).catch((e) => console.error('donor thank-you email failed:', e.message));
      }

      sendMail({
        to: GMAIL_USER,
        subject: `New donation: $${amount.toFixed(2)} from ${donorName}`,
        html: `<p><b>${donorName}</b> (${email || 'no email'}) just donated $${amount.toFixed(2)}.</p><p>Message: ${donorMessage || '(none)'}</p>`,
      }).catch((e) => console.error('owner donation notify failed:', e.message));

      console.log(`Donation logged: $${amount} from ${email || 'anonymous'}`);
    } catch (err) {
      console.error('Donation logging error:', err.message);
    }
    return { statusCode: 200, body: JSON.stringify({ received: true, type: 'donation' }) };
  }

  // Membership subscriptions
  let membershipTier;
  for (const [suffix, tier] of Object.entries(PAYMENT_LINK_TO_MEMBERSHIP)) {
    if (paymentLinkId.endsWith(suffix)) {
      membershipTier = tier;
      break;
    }
  }

  if (membershipTier) {
    try {
      const { record, isNew } = await upsertSubscriber(email, {
        name: customerName,
        tier: membershipTier,
        active: true,
        notes: 'Stripe subscription via membership purchase',
      });

      if (email) {
        sendMail({
          to: email,
          subject: `Welcome to Luckie's ${membershipTier} tier! 🐾`,
          html: `<p>Hi ${record.name},</p><p>You're now a <b>${membershipTier}</b> member of Luckie's pack — thank you for the support! Exclusive content coming your way 🐶</p><p>— Luckie & Nicholas</p>`,
        }).catch((e) => console.error('membership welcome email failed:', e.message));
      }

      sendMail({
        to: GMAIL_USER,
        subject: `New ${membershipTier} member: ${email}`,
        html: `<p>New membership purchase: <b>${record.name}</b> (${email}) — tier: ${membershipTier}</p>`,
      }).catch((e) => console.error('owner membership notify failed:', e.message));

      console.log(`${isNew ? 'Created' : 'Updated'} subscriber ${email} → tier: ${membershipTier}`);
    } catch (err) {
      console.error('Subscriber creation error:', err.message);
    }
    return { statusCode: 200, body: JSON.stringify({ received: true, membership: membershipTier }) };
  }

  // No address = not a shippable merch order
  if (!address) {
    return { statusCode: 200, body: JSON.stringify({ received: true, note: 'no address' }) };
  }

  // Merch orders → Printful fulfillment
  let product;
  for (const [suffix, prod] of Object.entries(PAYMENT_LINK_URL_TO_PRINTFUL)) {
    if (paymentLinkId.endsWith(suffix)) {
      product = prod;
      break;
    }
  }

  if (!product && STRIPE_SECRET) {
    try {
      const lineItems = await stripeGet(`checkout/sessions/${session.id}/line_items`);
      for (const item of lineItems.data || []) {
        const desc = (item.description || '').toLowerCase();
        if (desc.includes('tee') || desc.includes('shirt')) product = { sync_variant_id: 5311187830, name: 'Luckie Classic Tee' };
        else if (desc.includes('mug')) product = { sync_variant_id: 5311189811, name: 'Luckie Coffee Mug' };
        else if (desc.includes('hoodie')) product = { sync_variant_id: 5311188938, name: 'Luckie Hoodie' };
        else if (desc.includes('sticker')) product = { sync_variant_id: 5311188969, name: 'Luckie Sticker' };
        if (product) break;
      }
    } catch (e) {
      console.error('Line items lookup failed:', e.message);
    }
  }

  if (!product) {
    console.log('No merch product matched — skipping Printful.');
    return { statusCode: 200, body: JSON.stringify({ received: true, note: 'unmatched product' }) };
  }

  console.log(`Creating Printful order: ${product.name} for ${customerName}`);

  try {
    const result = await createPrintfulOrder(product.sync_variant_id, customerName, email, {
      line1: address.line1 || '',
      line2: address.line2 || '',
      city: address.city || '',
      state: address.state || '',
      postal_code: address.postal_code || '',
      country: address.country || 'US',
    });

    sendMail({
      to: GMAIL_USER,
      subject: `Merch sold: ${product.name} to ${customerName}`,
      html: `<p><b>${product.name}</b> ordered by ${customerName} (${email}). Printful order #${result.id} confirmed for production.</p>`,
    }).catch((e) => console.error('owner merch notify failed:', e.message));

    console.log('Printful order confirmed:', result.id);
    return { statusCode: 200, body: JSON.stringify({ received: true, printful_order_id: result.id }) };
  } catch (err) {
    console.error('Printful order error:', err.message);
    sendMail({
      to: GMAIL_USER,
      subject: `⚠️ Printful order FAILED for ${product.name}`,
      html: `<p>Order for <b>${product.name}</b> by ${customerName} (${email}) failed to submit to Printful: ${err.message}</p><p>You'll need to fulfill this one manually.</p>`,
    }).catch(() => {});
    return { statusCode: 200, body: JSON.stringify({ received: true, error: err.message }) };
  }
};
