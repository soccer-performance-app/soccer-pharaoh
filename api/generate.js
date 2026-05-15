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

    // Parse schedule into structured day array
    // Schedule format: "Mon: Solo Training\nTue: Gym / Workout\n..."
    const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const scheduleLines = schedule.split("\n");
    const weekPlan = {}; // { Mon: "Solo Training", Tue: "Gym / Workout", ... }
    scheduleLines.forEach(function(line) {
      const parts = line.split(": ");
      if (parts.length === 2) {
        weekPlan[parts[0].trim()] = parts[1].trim();
      }
    });

    // Build recovery context for each day
    // Returns a string describing what happened yesterday and rules for today
    function getRecoveryContext(targetDayType) {
      // Find which days have this type
      const targetDays = DAY_NAMES.filter(function(d) {
        return weekPlan[d] === targetDayType;
      });

      if (targetDays.length === 0) return "";

      const contexts = [];

      targetDays.forEach(function(day) {
        const dayIdx = DAY_NAMES.indexOf(day);
        const prevIdx = (dayIdx + 6) % 7; // day before (wraps Sunday -> Saturday)
        const prevDay = DAY_NAMES[prevIdx];
        const prevType = weekPlan[prevDay] || "Rest Day";
        const nextIdx = (dayIdx + 1) % 7;
        const nextDay = DAY_NAMES[nextIdx];
        const nextType = weekPlan[nextDay] || "Rest Day";

        let recoveryNote = "On " + day + " (" + targetDayType + "):\n";
        recoveryNote += "- Yesterday (" + prevDay + ") was: " + prevType + "\n";
        recoveryNote += "- Tomorrow (" + nextDay + ") will be: " + nextType + "\n";

        // Determine recovery rules based on what came before
        if (prevType === "Gym / Workout") {
          recoveryNote +=
            "- RECOVERY RULE: Heavy gym yesterday means lower body is fatigued. " +
            "Today must avoid heavy lower body loading. " +
            "Shift to upper body strength, core stability, or pure technical ball work with minimal ground impact. " +
            "No squats, deadlifts, lunges, or plyometrics today.\n";
        } else if (prevType === "Match Day") {
          recoveryNote +=
            "- RECOVERY RULE: Match yesterday. For " + position + ", the muscles most loaded were: " +
            getPositionSoreMuscles(position) + ". " +
            "Today must acknowledge this soreness explicitly at the session start. " +
            "Lower intensity by 30-40%. Avoid explosive work. Focus on mobility, light technical work, and blood flow. " +
            "No high-intensity sprinting or heavy loading.\n";
        } else if (prevType === "Solo Training") {
          recoveryNote +=
            "- RECOVERY RULE: Solo ball work yesterday. Lower body has moderate fatigue from running and change of direction. " +
            "Today should avoid high-volume sprint work if it's another solo day, " +
            "or focus on strength (not power) if it's a gym day.\n";
        } else if (prevType === "Team Practice") {
          recoveryNote +=
            "- RECOVERY RULE: Team practice yesterday involved collective running load. " +
            "Today reduce total running volume by 20% if solo, " +
            "or keep gym session focused on upper body and core rather than heavy leg work.\n";
        } else {
          recoveryNote +=
            "- RECOVERY RULE: Rest day yesterday. Full recovery assumed. " +
            "Today can be at full planned intensity.\n";
        }

        // Look ahead rules
        if (nextType === "Match Day") {
          recoveryNote +=
            "- LOOK AHEAD RULE: Match tomorrow. Today must not create fatigue that carries over. " +
            "Cap intensity at 75% maximum. No eccentric-heavy exercises. No max-effort sprints. " +
            "End session feeling fresh, not depleted.\n";
        } else if (nextType === "Gym / Workout") {
          recoveryNote +=
            "- LOOK AHEAD RULE: Gym tomorrow. Today's solo session should avoid loading the same muscle groups " +
            "the gym session will target tomorrow. Keep conditioning moderate.\n";
        }

        // Consecutive same-type rules
        if (targetDayType === "Gym / Workout") {
          const prevIsAlsoGym = prevType === "Gym / Workout";
          if (prevIsAlsoGym) {
            recoveryNote +=
              "- CONSECUTIVE GYM RULE: Yesterday was also a gym day. " +
              "Today MUST train completely different muscle groups from yesterday. " +
              "If yesterday was lower body dominant, today is upper body and core only. " +
              "If yesterday was upper body, today focuses on lower body but at reduced intensity (70% of normal). " +
              "State explicitly which muscle groups are being avoided and why.\n";
          }
        }

        contexts.push(recoveryNote);
      });

      return contexts.join("\n");
    }

    function getPositionSoreMuscles(pos) {
      const muscleMap = {
        "Goalkeeper (GK)": "hip flexors, adductors, rotator cuff, lumbar spine, and wrist/forearm from distribution",
        "Center Back (CB)": "hamstrings from sprint-deceleration, hip flexors, upper traps from aerial duels, lumbar spine",
        "Full Back / Wing Back (FB/WB)": "hip flexors, IT band, calves, adductors from crossing mechanics",
        "Defensive Midfielder (CDM)": "adductors, hip flexors, lower back from contact, thoracic spine",
        "Central Midfielder (CM)": "hip flexors, quadriceps, calves from high sprint volume, thoracic spine",
        "Attacking Midfielder (CAM)": "hip flexors, quadriceps from deceleration, groin, calves",
        "Winger (LW/RW)": "hamstrings, hip flexors, calves and Achilles from sprint volume, groin from cutting",
        "Striker / Centre Forward (ST/CF)": "hip flexors, hamstrings, quads from jump landing, upper back from hold-up contact"
      };
      return muscleMap[pos] || "lower body, hip flexors, and lumbar spine";
    }

    const athlete =
      "Position: " + position + "\n" +
      "Age: " + age + "\n" +
      "Fitness: " + fitness + "\n" +
      "Session duration: " + duration + " min\n" +
      "Goals: " + goals + "\n" +
      (injuries ? "Limitations: " + injuries + "\n" : "") +
      "Full weekly schedule:\n" + schedule;

    const FORMAT_RULE =
      "FORMATTING RULES:\n" +
      "- Exercise: **Bold Name (Variation)**: *X sets of Y reps, Zs rest, ABCD tempo*. Transfer sentence.\n" +
      "- Drill: **Bold Drill Name**: *X sets of Y reps / Z sec work, W sec rest*. Physical quality built.\n" +
      "- Numbered lists (01, 02...) for exercises and drills.\n" +
      "- #### for block headers. ### for session names.\n" +
      "- Sets/reps/rest/tempo always in *italics* on the same line as the bold name.\n" +
      "- Transfer explanation on the same line after italics — never on a new line.\n" +
      "- No placeholders. Every number explicit.";

    const RECOVERY_RULE =
      "RECOVERY AWARENESS RULES (apply to every session you write):\n" +
      "1. At the very start of each session, write a '#### Yesterday & Today' block. " +
      "State what was trained yesterday and in 2 sentences explain how today's session is adjusted for it.\n" +
      "2. If heavy gym lower body was yesterday: no squats, deadlifts, lunges, plyometrics today. Shift to upper body, core, or technical work.\n" +
      "3. If match day was yesterday: reduce intensity 30-40%, acknowledge the specific sore muscles for this position, focus on mobility and light technical work.\n" +
      "4. If consecutive gym days: second day must train different muscle groups from the first — state explicitly what is being avoided.\n" +
      "5. Solo sessions must complement not repeat gym sessions — if gym loaded hamstrings, solo avoids hamstring-dominant sprinting.\n" +
      "6. If match is tomorrow: cap today at 75% intensity, no eccentric-heavy work, player must finish feeling fresh.\n" +
      "7. Never ignore these rules even if the section request does not mention recovery.";

    const system =
      "You are an elite soccer performance coach writing recovery-aware training programs. " +
      "You understand that what happened yesterday directly determines what happens today. " +
      "Every session you write is shaped by the full weekly context. No isolated sessions. No filler.";

    let user = "";
    const recoveryCtx = getRecoveryContext(
      section === "match_day"    ? "Match Day" :
      section === "practice_day" ? "Team Practice" :
      section === "solo_day"     ? "Solo Training" :
      section === "gym_day"      ? "Gym / Workout" : ""
    );

    if (section === "position_demands") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write POSITION DEMANDS for " + position + ".\n\n" +
        "### Energy Systems\n" +
        "Each system: name, percentage, match action it powers.\n\n" +
        "### Key Muscle Groups\n" +
        "5 muscles/groups: name, why critical for this position, consequence of weakness.\n\n" +
        "### Match Metrics\n" +
        "Total distance, high-intensity distance, sprint count, avg sprint distance, contacts. Real data ranges.\n\n" +
        "### Elite vs Average\n" +
        "3 physical qualities separating elite from average at " + position + ". Specific and blunt.\n\n" +
        "### Weekly Recovery Profile\n" +
        "Given this schedule, identify the 2 highest fatigue accumulation points in the week and explain why. " +
        "Name the specific muscles at risk of overuse with this schedule for " + position + ".\n\n" +
        "### Age Note\n" +
        "How age " + age + " affects recovery between sessions specifically for this schedule.";
    }

    else if (section === "weekly_logic") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write WEEKLY LOAD LOGIC with full recovery awareness.\n\n" +
        "### Daily Schedule\n" +
        "List Mon-Sun. Each line: **Day**: Type — Focus (5 words) — Load: Low/Medium/High — Recovery status from previous day\n\n" +
        "### Load Structure\n" +
        "3 paragraphs: (1) how match day anchors the week, (2) how gym and solo are sequenced to avoid overlap, " +
        "(3) where recovery gaps are and why they are placed there.\n\n" +
        "### Muscle Group Weekly Map\n" +
        "Show which muscle groups are loaded on each active day. Identify any days where the same muscle group is loaded " +
        "on consecutive days — and explain how the program manages that risk.\n\n" +
        "### Load Distribution\n" +
        "Percentage of weekly load per day type. Include a fatigue curve description: when does load peak and when does it trough?";
    }

    else if (section === "match_day") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" +
        (recoveryCtx ? "RECOVERY CONTEXT FOR MATCH DAYS:\n" + recoveryCtx + "\n\n" : "") +
        "Write MATCH DAY PROTOCOL for " + position + ".\n\n" +
        "### Pre-Match Activation (start 75 min before kickoff)\n\n" +
        "#### Yesterday & Today\n" +
        "State what was trained the day before this match day and how the activation accounts for it.\n\n" +
        "#### Phase 1 — General Raise (10 min)\n" +
        "4 exercises. **Name**: *reps/duration*. Coaching cue on same line.\n\n" +
        "#### Phase 2 — Position Primer (8 min)\n" +
        "3 exercises specific to " + position + ". **Name**: *reps*. Why this primes this position.\n\n" +
        "#### Phase 3 — CNS Activation (4 min)\n" +
        "2 explosive actions. **Name**: *reps, rest between reps*. Nervous system quality fired.\n\n" +
        "### Post-Match Recovery\n\n" +
        "#### Minutes 0-20 (on site)\n" +
        "4 actions in order. Each: action, duration, reason.\n\n" +
        "#### Hours 1-4 (at home)\n" +
        "- **Contrast shower**: cold temp, hot temp, cycles, total time\n" +
        "- **Foam roll targets**: 4 specific muscles for " + position + ", 60s each\n" +
        "- **Nutrition**: exact macros, timing, specific foods\n\n" +
        "#### Day +1 Active Recovery\n" +
        "3 activities, duration, what to avoid.\n\n" +
        "### Match Nutrition\n" +
        "- **Pre-match meal** (3-4 hrs): foods, macros, portions\n" +
        "- **60 min before**: snack, exact amount\n" +
        "- **Half-time**: exact foods and amounts\n" +
        "- **Post-match within 30 min**: macros and options";
    }

    else if (section === "practice_day") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" +
        (recoveryCtx ? "RECOVERY CONTEXT FOR PRACTICE DAYS:\n" + recoveryCtx + "\n\n" : "") +
        "Write TEAM PRACTICE DAY PROTOCOL for " + position + ". " + counts.practice + " practice day(s) per week.\n\n" +
        "### Pre-Practice Add-On (arrive 20 min early)\n\n" +
        "#### Yesterday & Today\n" +
        "State what was trained the day before this practice day and how the add-on accounts for it.\n\n" +
        "#### Exercises\n" +
        "4 exercises numbered 01-04. Each: **Bold Name (Variation)**: *X sets of Y reps, Zs rest*. " +
        "What the team warm-up misses for " + position + " and how this fixes it.\n\n" +
        "### Post-Practice Add-On (stay 20 min after, RPE 6 max)\n\n" +
        "#### Exercises\n" +
        "4 exercises numbered 01-04. Each: **Bold Name (Variation)**: *X sets of Y reps, Zs rest*. " +
        "Physical quality team training leaves undertrained for " + position + ".\n\n" +
        "### Load Management Rules\n" +
        "3 rules. Each: **Rule name**: condition → exact adjustment → reason.";
    }

    else if (section === "solo_day") {
      const techMins = Math.round(parseInt(duration) * 0.55);
      const condMins = Math.round(parseInt(duration) * 0.20);
      const sessions = counts.solo || 1;

      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" +
        (recoveryCtx ? "RECOVERY CONTEXT FOR SOLO DAYS:\n" + recoveryCtx + "\n\n" : "") +
        "Write " + sessions + " SOLO TRAINING SESSION(S) for " + position + ". Ball required.\n\n";

      for (var s = 1; s <= sessions; s++) {
        // Figure out which day this session falls on to give accurate previous-day context
        const soloDays = DAY_NAMES.filter(function(d) { return weekPlan[d] === "Solo Training"; });
        const thisDay = soloDays[s - 1] || soloDays[0] || "unknown day";
        const prevIdx = DAY_NAMES.indexOf(thisDay);
        const prevDay = prevIdx >= 0 ? DAY_NAMES[(prevIdx + 6) % 7] : null;
        const prevType = prevDay ? (weekPlan[prevDay] || "Rest Day") : "Rest Day";

        user +=
          "### Session " + s + (sessions > 1 ? (s === 1 ? " — Technical Power" : " — Positional Conditioning") : "") + "\n" +
          "(This session falls on " + thisDay + ")\n\n" +
          "#### Yesterday & Today\n" +
          "Yesterday (" + (prevDay || "previous day") + ") was " + prevType + ". " +
          "In 2 sentences state which muscle groups or energy systems are fatigued and how this session is adjusted.\n\n" +
          "#### Warm-Up (10 min)\n" +
          "4 exercises. **Name**: *duration or reps*. Coaching cue. Ball from minute 4. " +
          "If yesterday was gym lower body, include extra hip flexor and quad mobility here.\n\n" +
          "#### Drill 1\n" +
          "**Drill Name**: *X sets, Y reps or Z sec work, W sec rest*\n" +
          "- Setup: exact distances in metres, cones, markers, equipment\n" +
          "- Execution: numbered steps\n" +
          "- Coaching cues: 2 specific technical points\n" +
          "- Physical quality: what this trains for " + position + " — must not duplicate yesterday's gym focus\n\n" +
          "#### Drill 2 (different physical quality from Drill 1)\n" +
          "Same format. Different quality. Must complement, not repeat, recent gym loading.\n\n" +
          "#### Conditioning Finish (" + condMins + " min)\n" +
          "**Drill Name**: *X rounds, Y sec work, Z sec rest*\n" +
          "Exact distances. Energy system. Why it matches " + position + " demands. " +
          "If match is tomorrow: reduce to 60% intensity and note this explicitly.\n\n" +
          "#### Cool-Down (5 min)\n" +
          "3 stretches numbered 01-03. **Name**: *duration each side*. Structure targeted.\n\n";
      }

      if (sessions > 1) {
        user += "IMPORTANT: Drill 1 and Drill 2 must be completely different exercises across sessions. No repeated drills.";
      }
    }

    else if (section === "gym_day") {
      const sessions = counts.gym || 1;

      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" +
        (recoveryCtx ? "RECOVERY CONTEXT FOR GYM DAYS:\n" + recoveryCtx + "\n\n" : "") +
        "Write " + sessions + " GYM SESSION(S) for " + position + ". No ball.\n\n";

      for (var g = 1; g <= sessions; g++) {
        const gymDays = DAY_NAMES.filter(function(d) { return weekPlan[d] === "Gym / Workout"; });
        const thisDay = gymDays[g - 1] || gymDays[0] || "unknown day";
        const prevIdx = DAY_NAMES.indexOf(thisDay);
        const prevDay = prevIdx >= 0 ? DAY_NAMES[(prevIdx + 6) % 7] : null;
        const prevType = prevDay ? (weekPlan[prevDay] || "Rest Day") : "Rest Day";
        const nextIdx = prevIdx >= 0 ? (prevIdx + 1) % 7 : -1;
        const nextDay = nextIdx >= 0 ? DAY_NAMES[nextIdx] : null;
        const nextType = nextDay ? (weekPlan[nextDay] || "Rest Day") : "Rest Day";

        const isConsecutiveGym = prevType === "Gym / Workout";
        const matchTomorrow = nextType === "Match Day";

        user +=
          "### Session " + g + (sessions > 1 ? (g === 1 ? " — Strength Foundation" : " — Power and Speed") : "") + "\n" +
          "(This session falls on " + thisDay + ")\n\n" +
          "#### Yesterday & Today\n" +
          "Yesterday (" + (prevDay || "previous day") + ") was " + prevType + ". " +
          (isConsecutiveGym ?
            "This is a consecutive gym day. State explicitly which muscle groups were loaded yesterday and confirm today trains DIFFERENT groups. " :
            "State which systems are recovered and how today builds on that. ") +
          (matchTomorrow ? "Match is tomorrow — cap intensity at 75% and note this. " : "") +
          "2 sentences maximum.\n\n" +
          "#### Activation Block (8 min)\n" +
          "3 exercises numbered 01-03. **Name**: *reps or duration*. Coaching cue. " +
          (isConsecutiveGym ? "Activation must target only the muscle groups being trained today — avoid yesterday's groups entirely.\n\n" : "\n\n") +
          "#### Main Block (5 exercises maximum)\n" +
          (isConsecutiveGym ?
            "MANDATORY: These 5 exercises must target different primary muscle groups from yesterday's gym session. State at the top which groups are OFF LIMITS today and why.\n" :
            "") +
          (matchTomorrow ?
            "MANDATORY: No eccentric-heavy exercises. No max-effort loading. All sets end 2 reps before failure. Note this at the top.\n" :
            "") +
          "5 exercises numbered 01-05. Each: **Exercise Name (Specific Variation)**: *X sets of Y reps, Zs rest, ABCD tempo*. " +
          "One sentence on the specific match situation for " + position + " this improves.\n\n" +
          "#### Power Finisher (8 min)\n" +
          (matchTomorrow ?
            "SKIP power finisher if match is tomorrow. Replace with 8 min of light mobility and nervous system down-regulation. State this explicitly.\n\n" :
            "2 exercises numbered 01-02. **Name**: *X sets of Y reps, Zs rest*. Explosive movement pattern for " + position + ".\n\n") +
          "#### Gym-to-Pitch Note\n" +
          "One paragraph. Connect today's session to a specific match scenario for " + position + ". " +
          "Also note how this session fits into the weekly recovery plan — what it protects and what it prepares.\n\n";
      }
    }

    else if (section === "periodization") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write 4-WEEK PERIODIZATION with recovery awareness built into every week.\n\n" +
        "Active days: " + [
          counts.match    > 0 ? counts.match    + " match"    : null,
          counts.practice > 0 ? counts.practice + " practice" : null,
          counts.solo     > 0 ? counts.solo     + " solo"     : null,
          counts.gym      > 0 ? counts.gym      + " gym"      : null,
        ].filter(Boolean).join(", ") + "\n\n" +
        "For each week:\n" +
        "### Week N: NAME\n" +
        "**Theme**: one sentence\n" +
        "**Recovery focus**: how this week manages fatigue accumulation\n" +
        "Per active day type:\n" +
        "- **Solo Training**: specific load change with numbers\n" +
        "- **Gym**: specific load change — note if muscle group rotation changes\n" +
        "- **Practice add-ons**: adjustment\n" +
        "- **Match day**: activation intensity note\n" +
        "**Monitor**: one recovery metric to watch\n\n" +
        "Week 1: Foundation — establish baseline, learn movement patterns, conservative loads\n" +
        "Week 2: Build — increase volume, introduce intensity, test recovery response\n" +
        "Week 3: Overload — peak stimulus, highest loads, maximum adaptation signal\n" +
        "Week 4: Deload — cut volume 40%, maintain intensity, peak for performance\n\n" +
        "After the 4 weeks, add a RECOVERY ARCHITECTURE section: identify the 3 most at-risk points in this schedule " +
        "for cumulative fatigue and give specific prevention strategies.";
    }

    else if (section === "benchmarks_warnings") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        "Write PERFORMANCE BENCHMARKS and CRITICAL WARNINGS for " + position + ".\n\n" +
        "### Performance Benchmarks\n" +
        "5 tests numbered 01-05. Each:\n" +
        "**Test Name**\n" +
        "- Protocol: exact steps, equipment, measurement\n" +
        "- Baseline (" + fitness + "): expected result now\n" +
        "- 8-week target: realistic improvement\n\n" +
        "### Critical Warnings\n" +
        "3 injury risks numbered 01-03. Each:\n" +
        "**Injury Name**\n" +
        "- Mechanism: exactly how it happens for " + position + " with this schedule\n" +
        "- Warning signs: what to feel before it becomes serious\n" +
        "- Prevention: 2 specific exercises with sets/reps\n\n" +
        "### Schedule-Specific Overuse Risks\n" +
        "Given this exact weekly schedule, identify 2 patterns that could cause cumulative overload over 4 weeks. " +
        "Name the muscle groups, explain the mechanism, and give the adjustment.\n\n" +
        "### Age " + age + " Note\n" +
        "How this age affects recovery time between sessions, injury risk with this schedule, and adaptation rate.";
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
