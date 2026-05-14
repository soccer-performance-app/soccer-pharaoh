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
      "Fitness level: " + fitness,
      "Session duration: " + duration + " minutes",
      "Goals: " + goals,
      injuries ? "Physical limitations: " + injuries : null,
      "",
      "Weekly schedule:",
      schedule,
      "",
      "Active days: " + [
        counts.match    > 0 ? counts.match    + " match day(s)"    : null,
        counts.practice > 0 ? counts.practice + " practice day(s)" : null,
        counts.solo     > 0 ? counts.solo     + " solo day(s)"     : null,
        counts.gym      > 0 ? counts.gym      + " gym day(s)"      : null,
      ].filter(Boolean).join(", "),
      "",
      "Write every section below in full. Only write sections that apply to the schedule above.",
      "",
      "## 1. POSITION DEMANDS",
      "150 words. Energy systems, key muscles, match metrics, what separates elite from average at this position.",
      "",
      "## 2. WEEKLY LOAD LOGIC",
      "List each day Mon-Sun with its type and a 4-word focus description. Explain the load sequencing in 3 sentences.",
      "",
      counts.match > 0 ? [
        "## 3. MATCH DAY PROTOCOL",
        "Pre-match activation sequence: Phase 1 general raise 10min (every exercise named with reps), Phase 2 position primer 8min (position-specific exercises named with reps), Phase 3 CNS activation 4min (explosive actions named with reps).",
        "Post-match recovery: minutes 0-20 on site, hours 1-3 at home including nutrition macros and contrast therapy, day+1 active recovery protocol.",
        "Match nutrition: pre-match meal with timing and macros, 60min pre snack, half-time fueling, post-match macros.",
      ].join("\n") : null,
      "",
      counts.practice > 0 ? [
        "## 4. TEAM PRACTICE DAY PROTOCOL",
        "Pre-practice individual add-on 20min: every exercise with sets, reps, and why it fills the gap for this position.",
        "Post-practice individual add-on 20min at RPE 6 max: every exercise with sets, reps, and quality targeted.",
        "3 load management rules with specific numbers and thresholds.",
      ].join("\n") : null,
      "",
      counts.solo > 0 ? [
        "## 5. SOLO TRAINING DAY PROTOCOL",
        "Write " + counts.solo + " complete session(s). For each session:",
        "- Warm-up 10min: full sequence with ball from minute 3",
        "- Technical-physical block " + Math.round(duration * 0.55) + "min: 2 drills with name, setup, execution, physical quality, volume",
        "- Conditioning finish " + Math.round(duration * 0.2) + "min: named drills, distances, work-rest ratios matching position energy system",
        "- Cool-down 5min: 3 stretches with name and structure targeted",
      ].join("\n") : null,
      "",
      counts.gym > 0 ? [
        "## 6. GYM WORKOUT DAY PROTOCOL",
        "Write " + counts.gym + " complete session(s). For each session:",
        "- Activation block 8min: 4 position-specific exercises with reps",
        "- Main block: 8 exercises each with name, sets x reps, rest period, tempo, one sentence on transfer to match performance",
        "- Power finisher 10min: 3 exercises matching position explosive demands with volume and rest",
        "- Gym-to-pitch note: one paragraph connecting this session to match performance",
      ].join("\n") : null,
      "",
      "## 7. 4-WEEK PERIODIZATION",
      "Week 1 Foundation, Week 2 Build, Week 3 Overload, Week 4 Deload. For each week give specific load changes per day type with actual numbers.",
      "",
      "## 8. PERFORMANCE BENCHMARKS",
      "5 position-specific tests. Each: exact test protocol, current expected baseline for this fitness level, realistic 8-week target.",
      "",
      "## 9. CRITICAL WARNINGS",
      "Top 3 injury risks for this position running this schedule. Each: risk name, mechanism, warning signs, prevention protocol. End with a note specific to age " + age + ".",
    ].filter(function(l) { return l !== null && l !== undefined; }).join("\n");

    const payload = JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user }
      ],
      max_tokens: 32768,
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
