const https = require("https");
 
module.exports = function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
 
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
 
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }
 
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).end("GEMINI_API_KEY environment variable is not set");
    return;
  }
 
  let rawBody = "";
  req.on("data", (chunk) => { rawBody += chunk; });
 
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch (e) {
      res.status(400).end("Invalid JSON");
      return;
    }
 
    const { systemPrompt = "", userPrompt = "" } = parsed;
 
    const payload = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.7 },
    });
 
    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        "Content-Length": Buffer.byteLength(payload),
      },
    };
 
    const upstream = https.request(options, (geminiRes) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.status(geminiRes.statusCode);
      geminiRes.pipe(res);
    });
 
    upstream.on("error", (err) => {
      if (!res.headersSent) res.status(502).end("Upstream error: " + err.message);
      else res.end();
    });
 
    upstream.write(payload);
    upstream.end();
  });
};
