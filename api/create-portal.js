const https = require("https");

module.exports = function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST")   { res.status(405).end("Method Not Allowed"); return; }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) { res.status(500).json({ error: "STRIPE_SECRET_KEY not set" }); return; }

  let rawBody = "";
  req.on("data", function(chunk) { rawBody += chunk; });
  req.on("end", function() {
    let parsed;
    try { parsed = JSON.parse(rawBody); } catch(e) {
      res.status(400).json({ error: "Invalid JSON" }); return;
    }

    const customerId = parsed.customerId || "";
    const returnUrl  = parsed.returnUrl  || "";
    if (!customerId) { res.status(400).json({ error: "Missing customerId" }); return; }
    if (!returnUrl)  { res.status(400).json({ error: "Missing returnUrl"  }); return; }

    const formBody = "customer=" + encodeURIComponent(customerId) +
                     "&return_url=" + encodeURIComponent(returnUrl);

    const stripeReq = https.request({
      hostname: "api.stripe.com",
      path:     "/v1/billing_portal/sessions",
      method:   "POST",
      headers: {
        "Authorization":  "Basic " + Buffer.from(secretKey + ":").toString("base64"),
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(formBody)
      }
    }, function(stripeRes) {
      let data = "";
      stripeRes.on("data", function(c) { data += c; });
      stripeRes.on("end", function() {
        try {
          const portal = JSON.parse(data);
          if (portal.url) {
            res.status(200).json({ url: portal.url });
          } else {
            res.status(500).json({ error: (portal.error && portal.error.message) || "No portal URL", raw: data });
          }
        } catch(e) {
          res.status(500).json({ error: "Failed to parse Stripe response", raw: data });
        }
      });
    });

    stripeReq.on("error", function(err) {
      res.status(502).json({ error: "Stripe request failed: " + err.message });
    });
    stripeReq.write(formBody);
    stripeReq.end();
  });

  req.on("error", function(err) {
    if (!res.headersSent) res.status(400).end("Request error: " + err.message);
  });
};
