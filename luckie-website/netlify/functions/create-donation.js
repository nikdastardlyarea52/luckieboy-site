// Creates a Stripe Checkout Session for a custom "pay what you want" donation amount.
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const SITE_URL = 'https://luckieboy.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const amount = Number(body.amount);
    const name = (body.name || '').trim();
    const message = (body.message || '').trim();
    const email = (body.email || '').trim();

    if (!amount || isNaN(amount) || amount < 1) {
      return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Please enter a valid donation amount (minimum $1).' }) };
    }
    if (amount > 5000) {
      return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'For donations over $5000, please contact us directly.' }) };
    }

    const unitAmount = Math.round(amount * 100);

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', SITE_URL + '?donation=success');
    params.set('cancel_url', SITE_URL + '?donation=cancelled');
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

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Stripe error:', data);
      return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: data.error?.message || 'Stripe error' }) };
    }

    return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: data.url }) };
  } catch (err) {
    console.error('create-donation error:', err.message);
    return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
