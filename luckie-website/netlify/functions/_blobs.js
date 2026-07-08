// Shared Netlify Blobs helpers — native, first-party data storage (no third-party DB).
const { getStore } = require('@netlify/blobs');

function subscribersStore() {
  return getStore('subscribers');
}
function donationsStore() {
  return getStore('donations');
}

// Subscribers are keyed by lowercase email so we can dedupe.
async function getSubscriber(email) {
  const store = subscribersStore();
  const data = await store.get(email.toLowerCase(), { type: 'json' });
  return data || null;
}

async function upsertSubscriber(email, fields) {
  const store = subscribersStore();
  const key = email.toLowerCase();
  const existing = (await store.get(key, { type: 'json' })) || null;
  const record = {
    email: key,
    name: fields.name || existing?.name || key.split('@')[0],
    tier: fields.tier || existing?.tier || 'Free',
    active: fields.active !== undefined ? fields.active : (existing?.active !== undefined ? existing.active : true),
    notes: fields.notes || existing?.notes || '',
    created_date: existing?.created_date || new Date().toISOString(),
    updated_date: new Date().toISOString(),
  };
  await store.setJSON(key, record);
  return { record, isNew: !existing };
}

async function listSubscribers() {
  const store = subscribersStore();
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    const data = await store.get(b.key, { type: 'json' });
    if (data) out.push(data);
  }
  return out;
}

async function createDonationRecord(fields) {
  const store = donationsStore();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    donor_name: fields.donor_name || 'Anonymous',
    donor_email: fields.donor_email || '',
    amount: fields.amount,
    message: fields.message || '',
    stripe_session_id: fields.stripe_session_id || '',
    created_date: new Date().toISOString(),
  };
  await store.setJSON(id, record);
  return record;
}

module.exports = { getSubscriber, upsertSubscriber, listSubscribers, createDonationRecord };
