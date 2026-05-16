const https = require("https");

module.exports = function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).end("Method Not Allowed"); return; }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) { res.status(500).json({ error: "STRIPE_SECRET_KEY not set" }); return; }

  let rawBody = "";
  req.on("data", function(chunk) { rawBody += chunk; });
  req.on("end", function() {
    let parsed;
    try { parsed = JSON.parse(rawBody); } catch(e) { res.status(400).json({ error: "Invalid JSON" }); return; }

    const sessionId = parsed.session_id;
    if (!sessionId) { res.status(400).json({ error: "Missing session_id" }); return; }

    const stripeReq = https.request({
      hostname: "api.stripe.com",
      path:     "/v1/checkout/sessions/" + sessionId,
      method:   "GET",
      headers: {
        "Authorization": "Basic " + Buffer.from(secretKey + ":").toString("base64")
      }
    }, function(stripeRes) {
      let data = "";
      stripeRes.on("data", function(chunk) { data += chunk; });
      stripeRes.on("end", function() {
        try {
          const session = JSON.parse(data);
          // payment_status is "paid" for one-time, subscription status is "active"
          const paid = session.payment_status === "paid" || session.status === "complete";
          res.status(200).json({ paid: paid, mode: session.mode });
        } catch(e) {
          res.status(500).json({ error: "Failed to parse Stripe response" });
        }
      });
    });

    stripeReq.on("error", function(err) {
      res.status(502).json({ error: "Stripe request failed: " + err.message });
    });

    stripeReq.end();
  });
};
