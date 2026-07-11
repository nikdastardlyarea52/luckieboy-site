// Vercel API route — creates a Stripe Checkout Session for donations
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const SITE_URL = 'https://luckieboy.com';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const amount = Number(body.amount);
    const name = (body.name || '').trim();
    const message = (body.message || '').trim();
    const email = (body.email || '').trim();

    if (!amount || isNaN(amount) || amount < 1)
      return res.status(400).json({ error: 'Please enter a valid donation amount (minimum $1).' });
    if (amount > 5000)
      return res.status(400).json({ error: 'For donations over $5000, please contact us directly.' });

    const unitAmount = Math.round(amount * 100);
    const params = new URLSearchParams();
    params.set('ui_mode', 'embedded');
    params.set('mode', 'payment');
    params.set('return_url', SITE_URL + '?donation=success');
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][unit_amount]', String(unitAmount));
    params.set('line_items[0][price_data][product_data][name]', "Donation to Luckie's Cause 🐾");
    params.set('line_items[0][price_data][product_data][description]', 'Supporting Luckie and his mission — thank you!');
    params.set('submit_type', 'donate');
    if (email) params.set('customer_email', email);
    params.set('metadata[type]', 'donation');
    if (name) params.set('metadata[donor_name]', name);
    if (message) params.set('metadata[donor_message]', message.slice(0, 450));

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await stripeRes.json();
    if (!stripeRes.ok) {
      console.error('Stripe error:', data);
      return res.status(500).json({ error: data.error?.message || 'Stripe error' });
    }

    return res.status(200).json({ clientSecret: data.client_secret });
  } catch (err) {
    console.error('create-donation error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
