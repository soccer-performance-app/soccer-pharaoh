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
    const section  = parsed.section  || "";
    const counts   = parsed.counts   || {};

    const athlete =
      "Position: " + position + "\n" +
      "Age: " + age + "\n" +
      "Fitness: " + fitness + "\n" +
      "Session duration: " + duration + " min\n" +
      "Goals: " + goals + "\n" +
      (injuries ? "Limitations: " + injuries + "\n" : "") +
      "Schedule:\n" + schedule;

    const FORMAT_RULE =
      "FORMATTING RULES — follow exactly:\n" +
      "- Exercise name: **Bold Name (Variation)**: *X sets of Y reps, Zs rest, ABCD tempo*. Transfer sentence.\n" +
      "- Drill name: **Bold Drill Name**: *X sets of Y reps / Z seconds work, Ws rest*. What physical quality this builds for this position.\n" +
      "- Use numbered lists (01, 02...) for exercises and drills.\n" +
      "- Use #### for block headers (ACTIVATION BLOCK, MAIN BLOCK, POWER FINISHER, etc.)\n" +
      "- Use ### for session names.\n" +
      "- Sets/reps/rest/tempo always in *italics* on the same line as the bold name.\n" +
      "- Transfer explanation always on the same line after the italics — never on a new line.\n" +
      "- No vague descriptions. Every number explicit. No placeholders.";

    const system =
      "You are an elite soccer performance coach writing a training program. " +
      "Write with surgical precision. Every exercise and drill fully specified. " +
      "No filler sentences. No generic advice. Format exactly as instructed.";

    let user = "";

    if (section === "position_demands") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write POSITION DEMANDS for " + position + ".\n\n" +
        "### Energy Systems\n" +
        "Name each system, percentage contribution, and what match action it powers.\n\n" +
        "### Key Muscle Groups\n" +
        "List the 5 most critical muscles/groups. For each: name, why it matters for this position, consequence of weakness.\n\n" +
        "### Match Metrics\n" +
        "Total distance, high-intensity distance, sprint count, avg sprint distance, contacts per match. Use real data ranges.\n\n" +
        "### Elite vs Average\n" +
        "3 specific physical qualities that separate elite from average at " + position + ". Be blunt and specific.\n\n" +
        "### Age Note\n" +
        "How age " + age + " affects these demands specifically.";
    }

    else if (section === "weekly_logic") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write WEEKLY LOAD LOGIC for this athlete.\n\n" +
        "### Daily Schedule\n" +
        "List Mon-Sun. Each line: **Day**: Type — Focus (5 words) — Load: Low/Medium/High\n\n" +
        "### Load Structure\n" +
        "3 paragraphs: (1) how match day anchors the week, (2) how gym and solo days complement without overlapping, (3) why rest days sit where they do.\n\n" +
        "### Load Distribution\n" +
        "Show percentage of weekly load per day type. E.g. Match day = 30%, Gym = 25%, etc.";
    }

    else if (section === "match_day") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write MATCH DAY PROTOCOL for " + position + ".\n\n" +
        "### Pre-Match Activation (start 75 min before kickoff)\n\n" +
        "#### Phase 1 — General Raise (10 min)\n" +
        "4 exercises. Format: **Name**: *reps/duration*. Coaching cue on same line.\n\n" +
        "#### Phase 2 — Position Primer (8 min)\n" +
        "3 exercises specific to " + position + ". Format: **Name**: *reps*. Why this primes this position specifically.\n\n" +
        "#### Phase 3 — CNS Activation (4 min)\n" +
        "2 explosive actions. Format: **Name**: *reps, rest between reps*. What nervous system quality this fires.\n\n" +
        "### Post-Match Recovery\n\n" +
        "#### Minutes 0-20 (on site)\n" +
        "List 4 actions in order. Each: action, duration, reason.\n\n" +
        "#### Hours 1-4 (at home)\n" +
        "- **Contrast shower**: cold temp, hot temp, cycles, total time\n" +
        "- **Foam roll targets**: list 4 specific muscles for " + position + ", 60s each\n" +
        "- **Nutrition**: exact macros (Xg protein, Yg carbs), timing, specific food examples\n\n" +
        "#### Day +1 Active Recovery\n" +
        "3 specific activities, duration each, what to avoid and why.\n\n" +
        "### Match Nutrition\n" +
        "- **Pre-match meal** (3-4 hrs before): foods, macros, portion size\n" +
        "- **60 min before**: specific snack, exact amount\n" +
        "- **Half-time**: exact foods and amounts\n" +
        "- **Post-match within 30 min**: Xg protein + Yg carbs, specific options";
    }

    else if (section === "practice_day") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write TEAM PRACTICE DAY PROTOCOL for " + position + ". " + counts.practice + " practice day(s) per week.\n\n" +
        "### Pre-Practice Add-On (arrive 20 min early)\n\n" +
        "#### Exercises\n" +
        "4 exercises numbered 01-04. Each: **Bold Name (Variation)**: *X sets of Y reps, Zs rest*. " +
        "Then: what the team warm-up fails to address for " + position + " and how this fixes it.\n\n" +
        "### Post-Practice Add-On (stay 20 min after, RPE 6 max)\n\n" +
        "#### Exercises\n" +
        "4 exercises numbered 01-04. Each: **Bold Name (Variation)**: *X sets of Y reps, Zs rest*. " +
        "Then: the specific physical quality team training leaves undertrained for " + position + ".\n\n" +
        "### Load Management Rules\n" +
        "3 rules. Each: **Rule name**: condition (if RPE > X / if session > Y min) → exact adjustment → reason.";
    }

    else if (section === "solo_day") {
      const techMins = Math.round(parseInt(duration) * 0.55);
      const condMins = Math.round(parseInt(duration) * 0.20);
      const sessions = counts.solo || 1;

      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write " + sessions + " SOLO TRAINING SESSION(S) for " + position + ". Ball required.\n\n";

      for (var s = 1; s <= sessions; s++) {
        user +=
          "### Session " + s + (sessions > 1 ? (s === 1 ? " — Technical Power" : " — Positional Conditioning") : "") + "\n\n" +
          "#### Warm-Up (10 min)\n" +
          "4 exercises. Each: **Name**: *duration or reps*. Coaching cue on same line. Ball from minute 4.\n\n" +
          "#### Drill 1\n" +
          "**Drill Name**: *X sets, Y reps or Z seconds work, Ws rest between sets*\n" +
          "- Setup: exact distances in metres, number of cones, markers, equipment\n" +
          "- Execution: numbered steps — what the player does on each rep\n" +
          "- Coaching cues: 2 specific technical points\n" +
          "- Physical quality: what this trains and why it matters for " + position + " in a match\n\n" +
          "#### Drill 2 (different physical quality from Drill 1)\n" +
          "Same format as Drill 1. Must train a different quality.\n\n" +
          "#### Conditioning Finish (" + condMins + " min)\n" +
          "**Drill Name**: *X rounds, Y seconds work, Z seconds rest*\n" +
          "Exact distances. Energy system targeted. Why this matches " + position + " match demands.\n\n" +
          "#### Cool-Down (5 min)\n" +
          "3 stretches numbered 01-03. Each: **Name**: *duration each side*. Structure targeted and why after this session.\n\n";
      }

      if (sessions > 1) {
        user += "NOTE: Drill 1 and Drill 2 must be completely different exercises across sessions. No repeated drills.";
      }
    }

    else if (section === "gym_day") {
      const sessions = counts.gym || 1;

      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write " + sessions + " GYM SESSION(S) for " + position + ". No ball.\n\n";

      for (var g = 1; g <= sessions; g++) {
        user +=
          "### Session " + g + (sessions > 1 ? (g === 1 ? " — Strength Foundation" : " — Power and Speed") : "") + "\n\n" +
          "#### Activation Block (8 min)\n" +
          "3 exercises numbered 01-03. Each: **Bold Name**: *reps or duration*. Coaching cue on same line.\n\n" +
          "#### Main Block (5 exercises maximum)\n" +
          "5 exercises numbered 01-05. For EACH use this exact format:\n" +
          "**Exercise Name (Specific Variation)**: *X sets of Y reps, Zs rest, ABCD tempo*. " +
          "One sentence: the specific match situation for " + position + " that this exercise directly improves.\n\n" +
          "Tempo format: eccentric-pause-concentric-top (e.g. 3-1-X-0 where X = explosive).\n\n" +
          "#### Power Finisher (8 min)\n" +
          "2 exercises numbered 01-02. Each: **Bold Name**: *X sets of Y reps, Zs rest*. " +
          "The exact explosive movement pattern this trains for " + position + ".\n\n" +
          "#### Gym-to-Pitch Note\n" +
          "One paragraph. Name a specific match scenario for " + position + " and connect it directly to what was trained today. Concrete. No generics.\n\n";
      }
    }

    else if (section === "periodization") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write 4-WEEK PERIODIZATION for this athlete.\n\n" +
        "Active days: " + [
          counts.match    > 0 ? counts.match    + " match"    : null,
          counts.practice > 0 ? counts.practice + " practice" : null,
          counts.solo     > 0 ? counts.solo     + " solo"     : null,
          counts.gym      > 0 ? counts.gym      + " gym"      : null,
        ].filter(Boolean).join(", ") + "\n\n" +
        "For each week use this format:\n\n" +
        "### Week N: NAME\n" +
        "**Theme**: one sentence goal\n" +
        "For each active day type use bullet points:\n" +
        "- **Solo Training**: specific change with numbers (e.g. Drill 1: increase from 4 sets to 5 sets)\n" +
        "- **Gym**: specific load change (e.g. Main Block: increase weight 5%, keep reps)\n" +
        "- **Practice add-ons**: specific adjustment\n" +
        "- **Match day**: specific focus\n" +
        "**Monitor**: one thing to watch for this week\n\n" +
        "Week 1: Foundation — establish baseline, perfect form, note starting loads\n" +
        "Week 2: Build — increase volume by specific amounts per day type\n" +
        "Week 3: Overload — peak stimulus, highest loads, push capacity\n" +
        "Week 4: Deload — cut volume 40%, maintain intensity, peak for performance";
    }

    else if (section === "benchmarks_warnings") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write PERFORMANCE BENCHMARKS and CRITICAL WARNINGS for " + position + ".\n\n" +
        "### Performance Benchmarks\n\n" +
        "5 tests numbered 01-05. For each:\n" +
        "**Test Name**\n" +
        "- Protocol: exact steps, equipment, how to measure\n" +
        "- Baseline (" + fitness + "): expected result right now\n" +
        "- 8-week target: realistic improvement with this program\n\n" +
        "### Critical Warnings\n\n" +
        "3 injury risks numbered 01-03. For each:\n" +
        "**Injury Name**\n" +
        "- Mechanism: exactly how it happens for " + position + "\n" +
        "- Warning signs: what to feel before it becomes serious\n" +
        "- Prevention: 2 specific exercises or habits with sets/reps\n\n" +
        "### Age " + age + " Note\n" +
        "How this age specifically affects recovery time, injury risk, and adaptation rate for this program. Practical adjustments.";
    }

    else {
      res.status(400).end("Unknown section: " + section);
      return;
    }

    const payload = JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user }
      ],
      max_tokens: 4000,
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
