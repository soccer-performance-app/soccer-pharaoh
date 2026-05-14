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

    // Pull the athlete data out of the userPrompt the frontend sends
    // and rebuild a much shorter prompt here on the server
    const userPrompt = parsed.userPrompt || "";

    // Extract key fields from the prompt the frontend built
    // The frontend embeds them as plain lines we can read
    const athleteLine  = (userPrompt.match(/ATHLETE: (.+)/) || [])[1] || "";
    const goalsLine    = (userPrompt.match(/GOALS: (.+)/) || [])[1] || "";
    const limitsLine   = (userPrompt.match(/LIMITATIONS: (.+)/) || [])[1] || "";
    const scheduleBlock = (userPrompt.match(/SCHEDULE:\n([\s\S]+?)\nSummary:/) || [])[1] || "";
    const summaryLine  = (userPrompt.match(/Summary: (.+)/) || [])[1] || "";

    const system = "You are an elite soccer performance coach. Write complete, specific, expert training programs. No filler. Use ## for sections, ### for subsections, #### for blocks, **bold** for exercises, *italics* for sets/reps/tempo, - for bullets.";

    const user = `Write a complete weekly soccer training program.

ATHLETE: ${athleteLine}
GOALS: ${goalsLine}
${limitsLine ? "LIMITATIONS: " + limitsLine : ""}
SCHEDULE:
${scheduleBlock}
(${summaryLine})

Write these sections IN FULL — every exercise named, every drill with setup and execution:

## 1. POSITION DEMANDS
Energy systems, key muscles, match metrics, elite vs average. 150 words.

## 2. WEEKLY LOAD LOGIC
Mon-Sun list with day type and 4-word focus. Load strategy in 2 sentences.

## 3. MATCH DAY PROTOCOL (if applicable)
Pre-match activation: General Raise 10min, Position Primer 8min, CNS Activation 4min. Post-match recovery: 0-20min, hours 1-3, day+1. Match nutrition timing and macros.

## 4. TEAM PRACTICE DAY PROTOCOL (if applicable)
Pre-practice add-on 20min: every exercise with sets and reps. Post-practice add-on 20min RPE6 max: every exercise with sets and reps. 3 load management rules.

## 5. SOLO TRAINING DAY PROTOCOL (if applicable)
One session per solo day. Each session: Warm-Up 10min, Technical-Physical Block with 2 drills (name, setup, execution, quality, volume), Conditioning Finish with named drills and work-rest ratios, Cool-Down 3 stretches.

## 6. GYM WORKOUT DAY PROTOCOL (if applicable)
One session per gym day. Each session: Activation 8min, Main Block 8 exercises (name, sets x reps, rest, tempo, transfer sentence), Power Finisher 3 exercises, Gym-to-Pitch note.

## 7. 4-WEEK PERIODIZATION
Week 1 Foundation, Week 2 Build, Week 3 Overload, Week 4 Deload. Specific load changes per day type each week.

## 8. PERFORMANCE BENCHMARKS
5 tests: protocol, current baseline, 8-week target.

## 9. CRITICAL WARNINGS
Top 3 injury risks: mechanism, warning signs, prevention. Age-specific note.

Write every section completely. Do not stop early.`;

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
