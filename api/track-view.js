// Vercel API route — lightweight blog post view tracker (logs only, no DB needed)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  console.log('view tracked:', body.slug || 'unknown');
  return res.status(200).json({ ok: true });
};
