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

    const system = "You are an elite soccer performance coach. Write complete, specific, expert content. No filler. No vague descriptions. Every exercise named. Every drill has setup, execution, and coaching cues.";

    let user = "";

    if (section === "position_demands") {
      user = athlete + "\n\n" +
        "Write the POSITION DEMANDS section for this athlete.\n\n" +
        "Cover:\n" +
        "- Dominant energy systems with percentages\n" +
        "- Key muscle groups and why they matter for this position\n" +
        "- Typical match metrics: distance covered, sprint count, sprint distances, contacts\n" +
        "- The 3 physical qualities that separate elite from average at this position\n" +
        "- How age " + age + " affects these demands\n\n" +
        "Write 250 words. Be specific to " + position + ". No generic soccer content.";
    }

    else if (section === "weekly_logic") {
      user = athlete + "\n\n" +
        "Write the WEEKLY LOAD LOGIC section for this athlete.\n\n" +
        "- List Mon-Sun. For each day show: day type, training focus in 5 words, load level (Low/Medium/High)\n" +
        "- Explain in 3 paragraphs: (1) how the schedule is structured around match day, (2) how gym and solo days complement each other, (3) why rest days are placed where they are\n" +
        "- State the weekly load distribution: what percentage of total load falls on each day type";
    }

    else if (section === "match_day") {
      user = athlete + "\n\n" +
        "Write the MATCH DAY PROTOCOL for this athlete.\n\n" +
        "PRE-MATCH ACTIVATION (start 75 min before kickoff, finish 10 min before):\n" +
        "Phase 1 - General Raise (10 min): List 4 exercises. Each: name, reps or duration, coaching cue.\n" +
        "Phase 2 - Position Primer (8 min): List 3 exercises specific to " + position + ". Each: name, reps, exactly why this primes this position.\n" +
        "Phase 3 - CNS Activation (4 min): List 2 explosive actions. Each: name, reps, rest between reps.\n\n" +
        "POST-MATCH RECOVERY:\n" +
        "- Minutes 0-20 on site: exact actions in order\n" +
        "- Hours 1-4 at home: cold/contrast protocol with temperatures and durations, foam roll targets, nutrition with exact macros and timing\n" +
        "- Day +1 active recovery: specific activities, duration, what to avoid\n\n" +
        "MATCH NUTRITION:\n" +
        "- Pre-match meal: timing, specific foods, macros\n" +
        "- 60 min before: specific snack\n" +
        "- Half-time: exact foods and amounts\n" +
        "- Post-match within 30 min: exact macros";
    }

    else if (section === "practice_day") {
      user = athlete + "\n\n" +
        "Write the TEAM PRACTICE DAY PROTOCOL for this athlete. " + counts.practice + " practice day(s) per week.\n\n" +
        "PRE-PRACTICE ADD-ON (arrive 20 min early):\n" +
        "List 4 exercises. For each: name, sets x reps, rest, coaching cue, and one sentence on why the team warm-up fails to address this for " + position + ".\n\n" +
        "POST-PRACTICE ADD-ON (stay 20 min after, RPE 6 max):\n" +
        "List 4 exercises. For each: name, sets x reps, rest, the specific physical quality it targets that team training ignores for " + position + ".\n\n" +
        "LOAD MANAGEMENT RULES:\n" +
        "Write 3 rules. Each rule must have: the specific condition (e.g. if team session RPE > 7), the exact adjustment, and the reason.";
    }

    else if (section === "solo_day") {
      const techMins = Math.round(parseInt(duration) * 0.55);
      const condMins = Math.round(parseInt(duration) * 0.20);
      user = athlete + "\n\n" +
        "Write " + counts.solo + " SOLO TRAINING SESSION(S) for this athlete. Ball required.\n\n" +
        "For EACH session write:\n\n" +
        "SESSION NAME AND PRIMARY STIMULUS (one line)\n\n" +
        "WARM-UP (10 min):\n" +
        "4 exercises progressing from general to specific. Ball involved from minute 4. Each: name, duration or reps, coaching cue.\n\n" +
        "DRILL 1 (position-specific technical-physical drill):\n" +
        "- Name\n" +
        "- Setup: exact distances, cones, markers, equipment\n" +
        "- Execution: step by step what the player does\n" +
        "- Reps/volume: exact sets and reps or time\n" +
        "- Rest: between reps and sets\n" +
        "- Coaching cues: 2 specific technical points to focus on\n" +
        "- Physical quality: what this develops and why it matters for " + position + "\n\n" +
        "DRILL 2 (different physical quality from Drill 1):\n" +
        "Same format as Drill 1.\n\n" +
        "CONDITIONING FINISH (" + condMins + " min):\n" +
        "A high-intensity conditioning block using the ball. Name the drill. Give exact distances, work period, rest period, number of rounds. Explain the energy system targeted and why it matches " + position + ".\n\n" +
        "COOL-DOWN (5 min):\n" +
        "3 stretches. Each: name, how to perform it, duration, which structure it targets and why that matters after this session.\n\n" +
        "Make Drill 1 and Drill 2 completely different between sessions if writing multiple sessions. No repeated drills.";
    }

    else if (section === "gym_day") {
      user = athlete + "\n\n" +
        "Write " + counts.gym + " GYM SESSION(S) for this athlete. No ball. Soccer-specific physical development only.\n\n" +
        "For EACH session write:\n\n" +
        "SESSION NAME AND PRIMARY STIMULUS (one line)\n\n" +
        "ACTIVATION (8 min):\n" +
        "3 exercises. Each: name, reps or duration, coaching cue. Target the muscles the main block will demand.\n\n" +
        "MAIN BLOCK (5 exercises maximum — quality over quantity):\n" +
        "For EACH exercise write ALL of these:\n" +
        "- Exercise name with specific variation (e.g. 'Trap Bar Deadlift' not just 'Deadlift')\n" +
        "- Sets x Reps\n" +
        "- Rest period\n" +
        "- Tempo (eccentric-pause-concentric-top, e.g. 3-1-X-0)\n" +
        "- Soccer transfer: exactly how this exercise improves " + position + " performance on the pitch. Be specific — name the match situation.\n\n" +
        "POWER FINISHER (8 min):\n" +
        "2 exercises. Each: name, sets x reps, rest, the exact explosive movement pattern it trains for " + position + ".\n\n" +
        "GYM-TO-PITCH NOTE:\n" +
        "One paragraph. Connect today's session to a specific match scenario for " + position + ". Be concrete.\n\n" +
        "If writing 2 sessions: Session 1 focuses on strength, Session 2 focuses on power and speed. Different exercises.";
    }

    else if (section === "periodization") {
      user = athlete + "\n\n" +
        "Write the 4-WEEK PERIODIZATION for this athlete.\n\n" +
        "Active day types: " + [
          counts.match    > 0 ? counts.match    + " match day(s)"    : null,
          counts.practice > 0 ? counts.practice + " practice day(s)" : null,
          counts.solo     > 0 ? counts.solo     + " solo day(s)"     : null,
          counts.gym      > 0 ? counts.gym      + " gym day(s)"      : null,
        ].filter(Boolean).join(", ") + "\n\n" +
        "For each of the 4 weeks, write:\n" +
        "- Week name and theme\n" +
        "- For each active day type: the specific change from the previous week (e.g. 'Gym: increase squat load by 5kg, add 1 rep per set')\n" +
        "- The key adaptation goal for that week\n" +
        "- One thing to monitor or watch for\n\n" +
        "Week 1: Foundation — establish baseline loads and movement patterns\n" +
        "Week 2: Build — increase volume by specific amounts\n" +
        "Week 3: Overload — peak stimulus, highest loads\n" +
        "Week 4: Deload — reduce volume 40%, maintain intensity, peak for performance";
    }

    else if (section === "benchmarks_warnings") {
      user = athlete + "\n\n" +
        "Write PERFORMANCE BENCHMARKS and CRITICAL WARNINGS for this athlete.\n\n" +
        "BENCHMARKS:\n" +
        "5 tests specific to " + position + ". For each:\n" +
        "- Test name\n" +
        "- Exact protocol (how to perform it, equipment needed, how to measure)\n" +
        "- Expected baseline for " + fitness + " fitness level\n" +
        "- Realistic target after 8 weeks of this program\n\n" +
        "CRITICAL WARNINGS:\n" +
        "Top 3 injury risks for " + position + " running this exact schedule. For each:\n" +
        "- Injury name\n" +
        "- Mechanism: exactly how it happens for this position\n" +
        "- Warning signs: what to feel or notice before it becomes serious\n" +
        "- Prevention: 2 specific exercises or habits that directly reduce this risk\n\n" +
        "End with a short note on how age " + age + " specifically affects recovery, injury risk, and training adaptation for this program.";
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
