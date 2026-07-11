// Vercel API route — Stripe webhook handler
// Handles donations, membership signups, and Printful merch fulfillment
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY_2 || '';
const PRINTFUL_STORE_ID = '18182792';
const GMAIL_USER = 'nikdastardlyarea52@gmail.com';

// Vercel must receive the raw body for signature verification


const PAYMENT_LINK_TO_MEMBERSHIP = {
  '6oU00kfyE1pYdlj2OMb3q05': 'Fan',
  '4gM7sM3PWd8G2GF752b3q06': 'Super Fan',
};

const PAYMENT_LINK_TO_PRINTFUL = {
  eVqeVe7280lUftr2OMb3q01: { sync_variant_id: 5311187830, name: 'Luckie Classic Tee' },
  eVq7sM5Y4b0ychfcpmb3q04: { sync_variant_id: 5311189811, name: 'Luckie Coffee Mug' },
  eVq14o86cecK9539dab3q03: { sync_variant_id: 5311188938, name: 'Luckie Hoodie' },
  '5kQ00kdqw8Sqa974WUb3q00': { sync_variant_id: 5311188969, name: 'Luckie Sticker' },
};

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  return t.sendMail({ from: `Luckie 🐾 <${GMAIL_USER}>`, to, subject, html, text: html.replace(/<[^>]+>/g, ' ') });
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(payload, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map(p => { const [k,v] = p.split('='); return [k,v]; }));
  const { t, v1 } = parts;
  if (!t || !v1) throw new Error('Malformed stripe-signature');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8'), b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Signature mismatch');
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new Error('Timestamp too old');
}

async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
  });
  return res.json();
}

async function createPrintfulOrder(syncVariantId, customerName, email, address) {
  const res = await fetch('https://api.printful.com/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PRINTFUL_API_KEY}`,
      'X-PF-Store-Id': PRINTFUL_STORE_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: {
        name: customerName, email,
        address1: address.line1, address2: address.line2 || '',
        city: address.city, state_code: address.state,
        zip: address.postal_code, country_code: address.country || 'US',
      },
      items: [{ sync_variant_id: syncVariantId, quantity: 1 }],
    }),
  });
  return res.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  try {
    verifySignature(rawBody.toString('utf8'), sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: err.message });
  }

  const event = JSON.parse(rawBody.toString('utf8'));

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const metadata = session.metadata || {};
  const customerEmail = session.customer_details?.email || session.customer_email || '';
  const customerName = session.customer_details?.name || metadata.donor_name || 'Friend';
  const paymentLinkId = session.payment_link?.split('/').pop() || session.payment_link || '';

  try {
    // --- DONATION ---
    if (metadata.type === 'donation') {
      const amountDollars = ((session.amount_total || 0) / 100).toFixed(2);

      sendMail({
        to: customerEmail,
        subject: "Thank you for supporting Luckie! 🐾",
        html: `<p>Hi ${customerName}!</p><p>Your donation of <b>$${amountDollars}</b> means the world to us. You're officially part of Luckie's pack 🐶</p>${metadata.donor_message ? `<p>"${metadata.donor_message}"</p>` : ''}<p>— Luckie & Nicholas</p>`,
      }).catch(e => console.error('donor thank-you failed:', e.message));

      sendMail({
        to: GMAIL_USER,
        subject: `💰 New donation: $${amountDollars} from ${customerName}`,
        html: `<p>Donation received!<br>Name: ${customerName}<br>Email: ${customerEmail}<br>Amount: $${amountDollars}<br>Message: ${metadata.donor_message || '—'}</p>`,
      }).catch(e => console.error('owner donation notify failed:', e.message));

    // --- MEMBERSHIP ---
    } else if (PAYMENT_LINK_TO_MEMBERSHIP[paymentLinkId]) {
      const tier = PAYMENT_LINK_TO_MEMBERSHIP[paymentLinkId];

      sendMail({
        to: customerEmail,
        subject: `Welcome to the ${tier} Pack! 🌟`,
        html: `<p>Hi ${customerName}!</p><p>You're now a <b>${tier}</b> member of Luckie's pack. Thank you so much for your support 🐾</p><p>— Luckie & Nicholas</p>`,
      }).catch(e => console.error('member welcome failed:', e.message));

      sendMail({
        to: GMAIL_USER,
        subject: `🌟 New ${tier} member: ${customerEmail}`,
        html: `<p>New ${tier} membership: ${customerName} (${customerEmail})</p>`,
      }).catch(e => console.error('owner member notify failed:', e.message));

    // --- MERCH / PRINTFUL ---
    } else if (PAYMENT_LINK_TO_PRINTFUL[paymentLinkId]) {
      const product = PAYMENT_LINK_TO_PRINTFUL[paymentLinkId];
      const address = session.customer_details?.address || session.shipping?.address || {};

      const pfResult = await createPrintfulOrder(product.sync_variant_id, customerName, customerEmail, address);
      console.log('Printful order result:', JSON.stringify(pfResult));

      sendMail({
        to: customerEmail,
        subject: `Your ${product.name} is on its way! 🐾`,
        html: `<p>Hi ${customerName}!</p><p>Thanks for ordering <b>${product.name}</b>! Your order has been placed and will ship soon 🎉</p><p>— Luckie & Nicholas</p>`,
      }).catch(e => console.error('merch confirm email failed:', e.message));

      sendMail({
        to: GMAIL_USER,
        subject: `🛍️ New merch order: ${product.name} — ${customerEmail}`,
        html: `<p>Merch order placed: ${product.name} for ${customerName} (${customerEmail})<br>Printful result: ${JSON.stringify(pfResult?.result || pfResult?.error || pfResult)}</p>`,
      }).catch(e => console.error('owner merch notify failed:', e.message));
    }
  } catch (err) {
    console.error('Webhook handler error:', err.message);
  }

  return res.status(200).json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };
