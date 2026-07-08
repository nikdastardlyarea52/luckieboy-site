const { getSubscriber, upsertSubscriber } = require('./_blobs');
const { sendMail, GMAIL_USER } = require('./_email');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TIER_MAP = { free: 'Free', fan: 'Fan', superfan: 'Super Fan' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').trim().toLowerCase();
    const name = (body.name || '').trim();
    const tierKey = (body.tier || 'free').toLowerCase();
    const notes = body.notes || '';

    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Valid email required' }) };
    }

    const tier = TIER_MAP[tierKey] || 'Free';
    const existing = await getSubscriber(email);

    const { record, isNew } = await upsertSubscriber(email, { name, tier, active: true, notes });

    if (isNew) {
      // Welcome email to the new subscriber
      sendMail({
        to: email,
        subject: "Welcome to the Pack! 🐾",
        html: `<p>Hey ${record.name}!</p><p>Thanks for joining Luckie's pack as a <b>${tier}</b> member. Get ready for photos, updates, and tail-wagging content 🐶</p><p>— Luckie & Nicholas</p>`,
      }).catch((e) => console.error('welcome email failed:', e.message));

      // Notify the owner
      sendMail({
        to: GMAIL_USER,
        subject: `New subscriber: ${email} (${tier})`,
        html: `<p>New signup: <b>${record.name}</b> (${email}) — tier: ${tier}</p>`,
      }).catch((e) => console.error('owner notify failed:', e.message));
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, status: isNew ? 'created' : 'existing' }),
    };
  } catch (err) {
    console.error('subscribe error:', err.message);
    return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
