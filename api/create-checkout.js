const https = require("https");

module.exports = function (req, res) {
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

    const origin = parsed.origin || "";
    if (!origin) { res.status(400).json({ error: "Missing origin" }); return; }

    // 'payment' (default, $2.99 one-time) or 'subscription' ($6.99/month)
    const type   = parsed.type   || "payment";
    const userId = parsed.userId || "";   // Supabase user_id — required for subscription webhook linking

    const successUrl = origin + "?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl  = origin + "?cancelled=true";

    let params;

    if (type === "subscription") {
      // ── SUBSCRIPTION MODE ────────────────────────────────────────────────
      // userId is embedded in metadata so the webhook can link the Stripe
      // customer back to the Supabase user on checkout.session.completed.
      params = {
        mode:                    "subscription",
        success_url:             successUrl,
        cancel_url:              cancelUrl,
        allow_promotion_codes:   "true",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]":                      "usd",
        "line_items[0][price_data][unit_amount]":                   "699",
        "line_items[0][price_data][recurring][interval]":           "month",
        "line_items[0][price_data][product_data][name]":            "Pitch Condition Monthly",
        "line_items[0][price_data][product_data][description]":
          "Monthly personalized soccer training program. Auto-updates every billing cycle.",
        "metadata[user_id]":                                        userId
      };
    } else {
      // ── ONE-TIME PAYMENT MODE ($2.99) ────────────────────────────────────
      params = {
        mode:                    "payment",
        success_url:             successUrl,
        cancel_url:              cancelUrl,
        allow_promotion_codes:   "true",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]":                      "usd",
        "line_items[0][price_data][unit_amount]":                   "299",
        "line_items[0][price_data][product_data][name]":            "Pitch Condition \u2014 Single Program",
        "line_items[0][price_data][product_data][description]":
          "One fully personalized soccer training program."
      };
    }

    const formBody = buildFormBody(params);

    const stripeReq = https.request({
      hostname: "api.stripe.com",
      path:     "/v1/checkout/sessions",
      method:   "POST",
      headers: {
        "Authorization":  "Basic " + Buffer.from(secretKey + ":").toString("base64"),
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(formBody)
      }
    }, function(stripeRes) {
      let data = "";
      stripeRes.on("data", function(chunk) { data += chunk; });
      stripeRes.on("end", function() {
        try {
          const session = JSON.parse(data);
          if (session.url) {
            res.status(200).json({ url: session.url });
          } else {
            res.status(500).json({
              error: (session.error && session.error.message) || "No session URL",
              raw:   data
            });
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

function buildFormBody(obj) {
  return Object.entries(obj)
    .map(function(pair) {
      return encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1]);
    })
    .join("&");
}
