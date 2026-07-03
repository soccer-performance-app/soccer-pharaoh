const https  = require("https");
const crypto = require("crypto");

// ── STRIPE WEBHOOK ───────────────────────────────────────────────────────────
// Listens for:
//   checkout.session.completed  (subscription) → links stripe_customer_id to user
//   invoice.payment_succeeded                  → sets renewal_pending = true
//   customer.subscription.deleted              → sets subscription_status = 'canceled'
//
// Env vars required:
//   STRIPE_WEBHOOK_SECRET      — from Stripe Dashboard → Webhooks → signing secret
//   SUPABASE_URL               — your project URL
//   SUPABASE_SERVICE_ROLE_KEY  — service role key (bypasses RLS)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = function(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST")   { res.status(405).end("Method Not Allowed"); return; }

  const webhookSecret  = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl    = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!webhookSecret)  { res.status(500).end("STRIPE_WEBHOOK_SECRET not set"); return; }
  if (!supabaseUrl)    { res.status(500).end("SUPABASE_URL not set");          return; }
  if (!serviceRoleKey) { res.status(500).end("SUPABASE_SERVICE_ROLE_KEY not set"); return; }

  // Accumulate raw body — required for Stripe signature verification.
  let rawBody = "";
  req.on("data", function(chunk) { rawBody += chunk; });

  req.on("end", function() {
    // ── 1. VERIFY STRIPE SIGNATURE ──────────────────────────────────────────
    const sigHeader = req.headers["stripe-signature"] || "";
    if (!verifyStripeSignature(rawBody, sigHeader, webhookSecret)) {
      console.error("Webhook signature verification failed");
      res.status(400).end("Invalid signature");
      return;
    }

    // ── 2. PARSE EVENT ───────────────────────────────────────────────────────
    let event;
    try { event = JSON.parse(rawBody); } catch(e) {
      res.status(400).end("Invalid JSON");
      return;
    }

    // Acknowledge immediately — Stripe will retry if we take too long.
    res.status(200).json({ received: true });

    // ── 3. HANDLE EVENTS ────────────────────────────────────────────────────
    const obj = event.data && event.data.object;

    if (event.type === "checkout.session.completed" && obj && obj.mode === "subscription") {
      // Link the Stripe customer to the Supabase user and mark subscription active.
      const userId     = obj.metadata && obj.metadata.user_id;
      const customerId = obj.customer;
      const subId      = obj.subscription;
      if (userId && customerId) {
        supabaseUpdate(supabaseUrl, serviceRoleKey,
          "profiles?user_id=eq." + userId,
          {
            stripe_customer_id:  customerId,
            subscription_id:     subId || null,
            subscription_status: "active"
          }
        ).catch(function(e) { console.error("checkout.session.completed update failed:", e); });
      }
    }

    else if (event.type === "invoice.payment_succeeded") {
      // Monthly renewal fired. Find the user by customer ID and set the renewal flag.
      // The client picks this up on next login and auto-triggers Get Updated Program.
      const customerId = obj && obj.customer;
      const billingReason = obj && obj.billing_reason;
      // Only trigger on renewals, not the first subscription invoice.
      if (customerId && billingReason === "subscription_cycle") {
        supabaseUpdate(supabaseUrl, serviceRoleKey,
          "profiles?stripe_customer_id=eq." + customerId,
          { renewal_pending: true }
        ).catch(function(e) { console.error("invoice.payment_succeeded update failed:", e); });
      }
    }

    else if (event.type === "customer.subscription.deleted") {
      const customerId = obj && obj.customer;
      if (customerId) {
        supabaseUpdate(supabaseUrl, serviceRoleKey,
          "profiles?stripe_customer_id=eq." + customerId,
          { subscription_status: "canceled" }
        ).catch(function(e) { console.error("subscription.deleted update failed:", e); });
      }
    }
  });

  req.on("error", function(err) {
    if (!res.headersSent) res.status(400).end("Request error: " + err.message);
  });
};

// ── STRIPE SIGNATURE VERIFICATION ────────────────────────────────────────────
// Implements https://stripe.com/docs/webhooks/signatures without the Stripe SDK.
function verifyStripeSignature(rawBody, sigHeader, secret) {
  var timestamp = null;
  var v1Sigs    = [];
  sigHeader.split(",").forEach(function(part) {
    if (part.startsWith("t="))  timestamp = part.slice(2);
    if (part.startsWith("v1=")) v1Sigs.push(part.slice(3));
  });
  if (!timestamp || v1Sigs.length === 0) return false;
  // Reject events older than 5 minutes to prevent replay attacks.
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false;
  var payload  = timestamp + "." + rawBody;
  var expected = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return v1Sigs.some(function(sig) { return sig === expected; });
}

// ── SUPABASE REST PATCH ───────────────────────────────────────────────────────
// PATCH /rest/v1/{table}?{filter} with the service role key (bypasses RLS).
function supabaseUpdate(supabaseUrl, serviceRoleKey, path, body) {
  return new Promise(function(resolve, reject) {
    var payload = JSON.stringify(body);
    var url     = new URL(supabaseUrl);
    var options = {
      hostname: url.hostname,
      path:     "/rest/v1/" + path,
      method:   "PATCH",
      headers: {
        "apikey":         serviceRoleKey,
        "Authorization":  "Bearer " + serviceRoleKey,
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Prefer":         "return=minimal"
      }
    };
    var req = https.request(options, function(res) {
      var data = "";
      res.on("data", function(c) { data += c; });
      res.on("end",  function()  {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error("Supabase PATCH " + res.statusCode + ": " + data));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
