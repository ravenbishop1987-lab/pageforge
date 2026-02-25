const express = require('express');
const router = express.Router();

// ─── POST /api/generate ───────────────────────────────────────────────
// Proxies Claude API call server-side so the API key is never exposed
router.post('/', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  const { prompt, wordCount } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt in request body.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      let msg = `Claude API error ${response.status}`;
      try {
        const d = await response.json();
        msg = d.error?.message || msg;
      } catch (e) {}
      return res.status(response.status).json({ error: msg });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text?.trim() || '';

    if (!text) {
      return res.status(500).json({ error: 'Empty response from Claude.' });
    }

    res.json({ html: text });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
