// api/generate.js
// Vercel Serverless Function (Node.js) — proxies to Google Gemini API.
// Intentionally NOT using Edge runtime — standard Node.js is more reliable
// for streaming on Vercel's free tier and requires no special config.
//
// DEPLOY CHECKLIST:
//   1. vercel env add GEMINI_API_KEY   (your AIza... key — never in code)
//   2. vercel --prod
//   3. No vercel.json needed — Vercel auto-routes /api/generate to this file.

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

module.exports = async function handler(req, res) {
  // CORS — allow requests from any origin (tighten to your domain in production)
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'GEMINI_API_KEY is not set. Add it via: vercel env add GEMINI_API_KEY'
    });
    return;
  }

  const { systemPrompt, userPrompt } = req.body || {};

  if (!userPrompt) {
    res.status(400).json({ error: 'Missing userPrompt in request body' });
    return;
  }

  const geminiPayload = {
    systemInstruction: {
      parts: [{ text: systemPrompt || '' }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.7,
    },
  };

  let upstream;
  try {
    upstream = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(geminiPayload),
    });
  } catch (err) {
    res.status(502).json({ error: `Failed to reach Gemini API: ${err.message}` });
    return;
  }

  if (!upstream.ok) {
    const errorText = await upstream.text();
    res.status(upstream.status).send(errorText);
    return;
  }

  // Stream Gemini's SSE response back to the browser
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders(); // Send headers immediately so the browser starts reading

  const reader  = upstream.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Forward each raw SSE chunk directly to the client
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    // Write an SSE-formatted error so the client can surface it
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
};
