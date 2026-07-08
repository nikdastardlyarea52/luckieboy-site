const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const postId = (body.postId || '').toString();
    if (!postId) return { statusCode: 400, body: JSON.stringify({ error: 'postId required' }) };

    const store = getStore('blog-views');
    const current = (await store.get(postId, { type: 'json' })) || { views: 0 };
    current.views = (current.views || 0) + 1;
    await store.setJSON(postId, current);

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ views: current.views }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ ok: false }) }; // non-critical, fail silently
  }
};
