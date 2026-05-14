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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).end("GROQ_API_KEY environment variable is not set");
    return;
  }

  let rawBody = "";
  req.on("data", function(chunk) { rawBody += chunk; });

  req.on("end", function() {
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch (e) {
      res.status(400).end("Invalid JSON");
      return;
    }

    const position = parsed.position || "";
    const age      = parsed.age      || "";
    const fitness  = parsed.fitness  || "";
    const duration = parsed.duration || "";
    const goals    = parsed.goals    || "";
    const injuries = parsed.injuries || "";
    const schedule = parsed.schedule || "";
    const counts   = parsed.counts   || {};

    const system = "You are an elite soccer performance coach. Write complete, detailed, position-specific training programs. Every exercise must be named with sets, reps, rest, and tempo. Every drill must have setup and execution. No filler. No placeholders.";

    const user = [
      "Write a complete weekly soccer training program for this athlete.",
      "",
      "Position: " + position,
      "Age: " + age,
      "Fitness: " + fitness,
      "Session duration: " + duration + " min",
      "Goals: " + goals,
      injuries ? "Limitations: " + injuries : null,
      "",
      "Schedule:",
      schedule,
      "",
      "Active: " + [
        counts.match    > 0 ? counts.match    + " match"    : null,
        counts.practice > 0 ? counts.practice + " practice" : null,
        counts.solo     > 0 ? counts.solo     + " solo"     : null,
        counts.gym      > 0 ? counts.gym      + " gym"      : null,
      ].filter(Boolean).join(", "),
      "",
      "Write only sections that apply. Be specific and complete for each.",
      "",
      "## 1. POSITION DEMANDS",
      "150 words. Energy systems, key muscles, match metrics, elite vs average.",
      "",
      "## 2. WEEKLY LOAD LOGIC",
      "Mon-Sun list with type and 4-word focus. 3 sentences on sequencing rationale.",
      "",
      counts.match > 0 ? "## 3. MATCH DAY PROTOCOL\nPre-match: Phase 1 general raise 10min, Phase 2 position primer 8min, Phase 3 CNS 4min. Name every exercise with reps.\nPost-match: 0-20min on site, hours 1-3 at home with macros and contrast, day+1 recovery.\nNutrition: pre-match meal timing and macros, 60min pre, half-time, post-match." : null,
      "",
      counts.practice > 0 ? "## 4. PRACTICE DAY PROTOCOL\nPre-practice 20min: every exercise with sets, reps, reason for this position.\nPost-practice 20min RPE6 max: every exercise with sets, reps, quality targeted.\n3 load rules with numbers." : null,
      "",
      counts.solo > 0 ? "## 5. SOLO TRAINING PROTOCOL\n" + counts.solo + " session(s). Each: warm-up 10min with ball from min 3, technical block " + Math.round(duration * 0.55) + "min with 2 drills (name/setup/execution/quality/volume), conditioning " + Math.round(duration * 0.2) + "min (named drills/distances/work-rest), cool-down 5min (3 stretches named)." : null,
      "",
      counts.gym > 0 ? "## 6. GYM PROTOCOL\n" + counts.gym + " session(s). Each: activation 8min (4 exercises with reps), main block (8 exercises each with name/sets x reps/rest/tempo/transfer sentence), power finisher 10min (3 exercises with volume and rest), gym-to-pitch paragraph." : null,
      "",
      "## 7. 4-WEEK PERIODIZATION",
      "Wk1 Foundation, Wk2 Build, Wk3 Overload, Wk4 Deload. Specific load numbers per day type each week.",
      "",
      "## 8. BENCHMARKS",
      "5 tests: protocol, baseline for " + fitness + " level, 8-week target.",
      "",
      "## 9. WARNINGS",
      "Top 3 injury risks: mechanism, warning signs, prevention. Age note for " + age + ".",
    ].filter(function(l) { return l !== null && l !== undefined; }).join("\n");

    const payload = JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user }
      ],
      max_tokens: 10000,
      temperature: 0.7,
      stream: true
    });

    const options = {
      hostname: "api.groq.com",
      path:     "/openai/v1/chat/completions",
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Authorization":  "Bearer " + apiKey,
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const upstream = https.request(options, function(groqRes) {
      res.setHeader("Content-Type",  "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection",    "keep-alive");
      res.status(groqRes.statusCode);
      groqRes.pipe(res);
    });

    upstream.on("error", function(err) {
      if (!res.headersSent) {
        res.status(502).end("Upstream error: " + err.message);
      } else {
        res.end();
      }
    });

    upstream.write(payload);
    upstream.end();
  });

  req.on("error", function(err) {
    if (!res.headersSent) {
      res.status(400).end("Request error: " + err.message);
    }
  });
};
