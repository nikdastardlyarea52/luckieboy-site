// Vercel API route — email subscriber signup, notifies owner via Gmail SMTP
const nodemailer = require('nodemailer');

const GMAIL_USER = 'nikdastardlyarea52@gmail.com';
const TIER_MAP = { free: 'Free', fan: 'Fan', superfan: 'Super Fan' };

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
    const email = (body.email || '').trim().toLowerCase();
    const name = (body.name || '').trim() || email.split('@')[0];
    const tierKey = (body.tier || 'free').toLowerCase();
    const tier = TIER_MAP[tierKey] || 'Free';

    if (!email || !email.includes('@'))
      return res.status(400).json({ error: 'Valid email required' });

    // Welcome email to subscriber
    sendMail({
      to: email,
      subject: "Welcome to the Pack! 🐾",
      html: `<p>Hey ${name}!</p><p>Thanks for joining Luckie's pack as a <b>${tier}</b> member. Get ready for photos, updates, and tail-wagging content 🐶</p><p>— Luckie & Nicholas</p>`,
    }).catch(e => console.error('welcome email failed:', e.message));

    // Notify owner
    sendMail({
      to: GMAIL_USER,
      subject: `New subscriber: ${email} (${tier})`,
      html: `<p>New signup: <b>${name}</b> (${email}) — tier: ${tier}</p>`,
    }).catch(e => console.error('owner notify failed:', e.message));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('subscribe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
