const https = require("https");

module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).end("Method Not Allowed"); return; }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) { res.status(500).json({ error: "STRIPE_SECRET_KEY not set" }); return; }

  let rawBody = "";
  req.on("data", function(chunk) { rawBody += chunk; });
  req.on("end", async function() {
    let parsed;
    try { parsed = JSON.parse(rawBody); } catch(e) { res.status(400).json({ error: "Invalid JSON" }); return; }

    const mode       = parsed.mode;       // "payment" or "subscription"
    const origin     = parsed.origin;     // the app's URL for redirect
    const athleteKey = parsed.athleteKey; // encoded athlete data to pass through

    if (!mode || !origin) { res.status(400).json({ error: "Missing mode or origin" }); return; }

    // Build the Stripe Checkout session payload
    const successUrl = origin + "?session_id={CHECKOUT_SESSION_ID}&athlete=" + encodeURIComponent(athleteKey || "");
    const cancelUrl  = origin + "?cancelled=true";

    let lineItems;
    let checkoutMode;

    if (mode === "payment") {
      checkoutMode = "payment";
      lineItems = [{
        price_data: {
          currency: "usd",
          unit_amount: 299, // $2.99
          product_data: {
            name: "Pitch Condition — Single Program",
            description: "One fully personalized soccer training program"
          }
        },
        quantity: 1
      }];
    } else if (mode === "subscription") {
      checkoutMode = "subscription";
      lineItems = [{
        price_data: {
          currency: "usd",
          unit_amount: 1000, // $10.00
          recurring: { interval: "month" },
          product_data: {
            name: "Pitch Condition — Monthly",
            description: "Unlimited programs, up to 12 per month"
          }
        },
        quantity: 1
      }];
    } else {
      res.status(400).json({ error: "Invalid mode" }); return;
    }

    const body = JSON.stringify({
      mode: checkoutMode,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url:  cancelUrl,
      allow_promotion_codes: true
    });

    // Call Stripe API directly with https (no SDK needed)
    const stripeReq = https.request({
      hostname: "api.stripe.com",
      path:     "/v1/checkout/sessions",
      method:   "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(secretKey + ":").toString("base64"),
        "Content-Type":  "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(buildFormBody({
          mode: checkoutMode,
          success_url: successUrl,
          cancel_url:  cancelUrl,
          allow_promotion_codes: "true",
          "line_items[0][quantity]": "1",
          ...(mode === "payment" ? {
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][unit_amount]": "299",
            "line_items[0][price_data][product_data][name]": "Pitch Condition \u2014 Single Program",
            "line_items[0][price_data][product_data][description]": "One fully personalized soccer training program"
          } : {
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][unit_amount]": "1000",
            "line_items[0][price_data][recurring][interval]": "month",
            "line_items[0][price_data][product_data][name]": "Pitch Condition \u2014 Monthly",
            "line_items[0][price_data][product_data][description]": "Unlimited programs, up to 12 per month"
          })
        }))
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
            res.status(500).json({ error: session.error || "No session URL returned", raw: data });
          }
        } catch(e) {
          res.status(500).json({ error: "Failed to parse Stripe response", raw: data });
        }
      });
    });

    stripeReq.on("error", function(err) {
      res.status(502).json({ error: "Stripe request failed: " + err.message });
    });

    const formBody = buildFormBody({
      mode: checkoutMode,
      success_url: successUrl,
      cancel_url:  cancelUrl,
      allow_promotion_codes: "true",
      "line_items[0][quantity]": "1",
      ...(mode === "payment" ? {
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": "299",
        "line_items[0][price_data][product_data][name]": "Pitch Condition \u2014 Single Program",
        "line_items[0][price_data][product_data][description]": "One fully personalized soccer training program"
      } : {
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": "1000",
        "line_items[0][price_data][recurring][interval]": "month",
        "line_items[0][price_data][product_data][name]": "Pitch Condition \u2014 Monthly",
        "line_items[0][price_data][product_data][description]": "Unlimited programs, up to 12 per month"
      })
    });

    stripeReq.write(formBody);
    stripeReq.end();
  });
};

function buildFormBody(obj) {
  return Object.entries(obj)
    .map(function(pair) {
      return encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1]);
    })
    .join("&");
}
