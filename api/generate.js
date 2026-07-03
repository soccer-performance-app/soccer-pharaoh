const https = require("https");

module.exports = function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).end("Method Not Allowed"); return; }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) { res.status(500).end("OPENROUTER_API_KEY not set"); return; }

  let rawBody = "";
  req.on("data", function(chunk) { rawBody += chunk; });

  req.on("end", function() {
    let parsed;
    try { parsed = JSON.parse(rawBody); } catch(e) { res.status(400).end("Invalid JSON"); return; }

    const position  = parsed.position  || "";
    const age       = parsed.age       || "";
    const fitness   = parsed.fitness   || "";
    const duration  = parsed.duration  || "";
    const goals     = parsed.goals     || "";
    const techGoals = parsed.techGoals || "";
    const injuries  = parsed.injuries  || "";
    const schedule  = parsed.schedule  || "";
    const section   = parsed.section   || "";
    const counts    = parsed.counts    || {};
    const sex       = String(parsed.sex || "").toLowerCase();
    const heightCm  = parseFloat(parsed.heightCm) || 0;
    const weightKg  = parseFloat(parsed.weightKg) || 0;
    const space     = parsed.space || "";

    // ── PROGRESSION FIELDS ───────────────────────────────────────────────────
    // Sent by the client when the user clicks "Get Updated Program".
    // previousProgram = plain-text content of the same section from the prior program.
    // progressionContext = notes on what changed (fitness, injuries, etc.)
    const previousProgram    = String(parsed.previousProgram    || "").slice(0, 4000);
    const progressionContext = String(parsed.progressionContext || "").slice(0, 800);
    // ─────────────────────────────────────────────────────────────────────────

    const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const scheduleLines = schedule.split("\n");
    const weekPlan = {};
    scheduleLines.forEach(function(line) {
      const parts = line.split(": ");
      if (parts.length === 2) weekPlan[parts[0].trim()] = parts[1].trim();
    });

    function getRecoveryContext(targetDayType) {
      const targetDays = DAY_NAMES.filter(function(d) { return weekPlan[d] === targetDayType; });
      if (targetDays.length === 0) return "";
      const contexts = [];
      targetDays.forEach(function(day) {
        const dayIdx = DAY_NAMES.indexOf(day);
        const prevDay = DAY_NAMES[(dayIdx + 6) % 7];
        const prevType = weekPlan[prevDay] || "Rest Day";
        const nextDay = DAY_NAMES[(dayIdx + 1) % 7];
        const nextType = weekPlan[nextDay] || "Rest Day";
        let note = "On " + day + " (" + targetDayType + "):\n";
        note += "- Yesterday (" + prevDay + ") was: " + prevType + "\n";
        note += "- Tomorrow (" + nextDay + ") will be: " + nextType + "\n";
        if (prevType === "Gym / Workout") note += "- RECOVERY RULE: Heavy gym yesterday. Avoid heavy lower body loading today.\n";
        else if (prevType === "Match Day") note += "- RECOVERY RULE: Match yesterday. " + position + " sore muscles: " + getPositionSoreMuscles(position) + ". Reduce intensity 30-40%.\n";
        else if (prevType === "Solo Training") note += "- RECOVERY RULE: Solo session yesterday. Moderate lower body fatigue.\n";
        else if (prevType === "Team Practice") note += "- RECOVERY RULE: Team practice yesterday. Reduce total running volume 20%.\n";
        else note += "- RECOVERY RULE: Rest day yesterday. Full recovery. Today at full planned intensity.\n";
        if (nextType === "Match Day") note += "- LOOK AHEAD: Match tomorrow. Cap intensity 75%. No eccentric-heavy exercises.\n";
        else if (nextType === "Gym / Workout") note += "- LOOK AHEAD: Gym tomorrow. Avoid loading same muscle groups.\n";
        if (targetDayType === "Gym / Workout" && prevType === "Gym / Workout") note += "- CONSECUTIVE GYM RULE: Yesterday also gym. Today MUST train completely different muscle groups.\n";
        contexts.push(note);
      });
      return contexts.join("\n");
    }

    function getPositionSoreMuscles(pos) {
      const map = {
        "Goalkeeper (GK)": "hip flexors, adductors, rotator cuff, lumbar spine, wrist/forearm",
        "Center Back (CB)": "hamstrings, hip flexors, upper traps from aerial duels, lumbar spine",
        "Full Back / Wing Back (FB/WB)": "hip flexors, IT band, calves, adductors from crossing",
        "Defensive Midfielder (CDM)": "adductors, hip flexors, lower back, thoracic spine",
        "Central Midfielder (CM)": "hip flexors, quadriceps, calves, thoracic spine",
        "Attacking Midfielder (CAM)": "hip flexors, quadriceps from deceleration, groin, calves",
        "Winger (LW/RW)": "hamstrings, hip flexors, calves, Achilles, groin from cutting",
        "Striker / Centre Forward (ST/CF)": "hip flexors, hamstrings, quads from jump landing, upper back"
      };
      return map[pos] || "lower body, hip flexors, lumbar spine";
    }

    const techGoalLine = techGoals ? "\nTechnical Goals: " + techGoals : "";

    const athlete =
      "Position: " + position + "\n" +
      "Age: " + age + "\n" +
      (heightCm ? "Height: " + heightCm + " cm\n" : "") +
      (weightKg ? "Weight: " + weightKg + " kg\n" : "") +
      (sex ? "Sex: " + sex + "\n" : "") +
      "Fitness: " + fitness + "\n" +
      "Session duration: " + duration + " min\n" +
      "Physical Goals: " + goals + "\n" +
      (techGoals ? "Technical Goals: " + techGoals + "\n" : "") +
      (injuries ? "Limitations: " + injuries + "\n" : "") +
      (space ? "Training space available: " + space + "\n" : "") +
      "Full weekly schedule:\n" + schedule;

    const FORMAT_RULE =
      "FORMATTING RULES:\n" +
      "- Exercise: **Bold Name (Variation)**: *X sets of Y reps, Zs rest, ABCD tempo*. Transfer sentence.\n" +
      "- Drill: **Bold Drill Name**: *X sets of Y reps / Z sec work, W sec rest*. Physical quality built.\n" +
      "- Numbered lists (01, 02...) for exercises and drills.\n" +
      "- #### for block headers. ### for session names.\n" +
      "- Sets/reps/rest/tempo always in *italics* on the same line as the bold name.\n" +
      "- Transfer explanation on the same line after italics.\n" +
      "- No placeholders. Every number explicit.";

    const RECOVERY_RULE =
      "RECOVERY AWARENESS (apply to every session):\n" +
      "1. Start each session with '#### Yesterday & Today' — state what was trained yesterday and how today adjusts.\n" +
      "2. Gym lower body yesterday: no squats, deadlifts, lunges, plyometrics.\n" +
      "3. Match yesterday: reduce intensity 30-40%, focus on mobility and light technical work.\n" +
      "4. Consecutive gym days: second day trains different muscle groups.\n" +
      "5. Solo sessions complement gym — avoid overlap.\n" +
      "6. Match tomorrow: cap at 75%, no eccentric-heavy work.";

    const TECH_GOAL_RULE = techGoals ?
      "TECHNICAL GOAL INTEGRATION — NON-NEGOTIABLE:\n" +
      "The athlete has selected these technical goals: " + techGoals + "\n" +
      "Every drill, exercise, and session must directly develop at least one of these technical qualities.\n" +
      "Name which technical goal each drill develops. Do not include generic drills that don't connect to these goals.\n" +
      "The program must feel like it was built specifically for someone trying to improve " + techGoals + "." : "";

    const SOLO_DRILL_RULES =
      "SOLO DRILL QUALITY RULES — NON-NEGOTIABLE:\n" +
      "1. BANNED drills: figure 8 dribbling, cone weaves, stationary ball mastery, juggling circuits, slow technical drills.\n" +
      "2. Every drill must replicate a SPECIFIC IN-GAME SITUATION.\n" +
      "3. Every drill must involve EXPLOSIVE INTENSITY.\n" +
      "4. Every drill must have a FATIGUE COMPONENT.\n" +
      "5. Drill format MANDATORY:\n" +
      "   - Game scenario: exact match situation this replicates\n" +
      "   - Setup: distances in metres, cones, equipment\n" +
      "   - Execution: numbered steps\n" +
      "   - Coaching cues: 2 specific technical points\n" +
      "   - Physical demand: athletic quality being trained\n" +
      "   - Technical quality: which of the athlete's technical goals this develops\n" +
      "   - Volume: sets x reps, rest between reps, rest between sets\n" +
      "6. Zero repeated drills across sessions.";

    const NO_NUTRITION_RULE =
      "NUTRITION EXCLUSION — NON-NEGOTIABLE:\n" +
      "Do NOT include any nutrition, food, meal, snack, drink, supplement, or fueling guidance in this section. " +
      "All nutrition lives exclusively in the dedicated NUTRITION PROTOCOL section of this program. " +
      "If a recovery or preparation step would normally involve food or drink, omit it and use a non-nutrition action instead.";

    const SPACE_DETAIL = {
      "Backyard / Small Space":
        "- Usable area is roughly 10-20 metres, no goal, possibly a wall and a fence.\n" +
        "- BANNED: full-pitch sprints, any run longer than ~20m, long shuttle runs, drills requiring a goal, a large grid, or a teammate.\n" +
        "- SUBSTITUTE WITH: tight-space ball manipulation under time pressure, wall passing and rebound control, rapid footwork over lines/markers, 5-10m acceleration bursts, bodyweight plyometrics and strength, and mobility. Conditioning becomes short work:rest intervals in place or over 5-10m — never distance running.",
      "Indoors / Very Limited":
        "- Usable area is tiny (a room or garage, ~3-5 metres), hard floor, with ceiling and noise limits.\n" +
        "- BANNED: all running and sprinting, long passes, shooting, unsafe indoor jumping, and any drill needing distance or a goal.\n" +
        "- SUBSTITUTE WITH: stationary and 2-3m ball control (sole rolls, taps, tight close-dribble figures), wall work where a wall exists, controlled footwork, isometrics, bodyweight strength, core, and mobility. Conditioning is low-impact in-place circuits measured by time, never by distance.",
      "Half Field":
        "- Roughly half a pitch (~50m) is available, likely with one goal.\n" +
        "- Allowed: most drills, runs and sprints up to ~40m, and finishing on a single goal.\n" +
        "- AVOID full-pitch (90-100m) or end-to-end work — scale any such distance down to the half-field length.",
      "Full Field / Pitch":
        "- A full pitch with goals is available. No spatial restriction: full sprints, long runs, transition distances, and goal work are all permitted."
    };

    const SPACE_RULE = space ?
      "TRAINING SPACE CONSTRAINT — NON-NEGOTIABLE:\n" +
      "The athlete trains in this space: " + space + ".\n" +
      "This constraint OVERRIDES every distance, run length, sprint, grid size, or area figure mentioned anywhere else in this prompt. " +
      "If any instruction specifies a distance or area larger than the space allows, scale it down to fit or replace it with a space-appropriate substitute that trains the SAME physical and technical quality. " +
      "Never drop the training target — only change how it is achieved.\n" +
      (SPACE_DETAIL[space] || "- No specific space data; keep every drill adaptable and state any space assumption made.") : "";

    const system =
      "You are an elite soccer performance coach and technical skills specialist. " +
      "You write match-preparation training sessions that develop both physical and technical qualities simultaneously. " +
      "Every drill replicates a real match situation and directly develops the athlete's stated technical goals. " +
      "No filler. No generic content. Every session feels like it was built for this specific player.";

    let user = "";
    const recoveryCtx = getRecoveryContext(
      section === "match_day"    ? "Match Day" :
      section === "practice_day" ? "Team Practice" :
      section === "solo_day"     ? "Solo Training" :
      section === "gym_day"      ? "Gym / Workout" : ""
    );

    if (section === "position_demands") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
        (TECH_GOAL_RULE ? TECH_GOAL_RULE + "\n\n" : "") +
        "Write POSITION DEMANDS for " + position + ".\n\n" +
        "### Energy Systems\n" +
        "Each system: name, percentage, match action it powers.\n\n" +
        "### Key Muscle Groups\n" +
        "5 muscles/groups: name, why critical, consequence of weakness.\n\n" +
        "### Match Metrics\n" +
        "Total distance, high-intensity distance, sprint count, avg sprint distance, contacts. Real data ranges.\n\n" +
        "### Technical Demands\n" +
        (techGoals ? "For each of these technical goals: " + techGoals + " — explain exactly what the position demands technically, what elite looks like vs average, and what physically limits technical execution under fatigue.\n\n" :
        "Top 5 technical qualities for " + position + ". What elite looks like vs average for each.\n\n") +
        "### Elite vs Average\n" +
        "3 physical AND technical qualities separating elite from average at " + position + ". Specific and blunt.\n\n" +
        "### Weekly Recovery Profile\n" +
        "2 highest fatigue accumulation points in this schedule. Muscles at risk of overuse.\n\n" +
        "### Age Note\n" +
        "How age " + age + " affects recovery between sessions for this schedule.";
    }

    else if (section === "weekly_logic") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + (SPACE_RULE ? SPACE_RULE + "\n\n" : "") + NO_NUTRITION_RULE + "\n\n" +
        (TECH_GOAL_RULE ? TECH_GOAL_RULE + "\n\n" : "") +
        "Write WEEKLY LOAD LOGIC with full recovery awareness.\n\n" +
        "### Daily Schedule\n" +
        "List Mon-Sun. Each line: **Day**: Type — Focus (5 words) — Load: Low/Medium/High — Recovery status from previous day\n\n" +
        "### Load Structure\n" +
        "3 paragraphs: (1) how match day anchors the week, (2) how gym and solo avoid overlap, (3) where recovery gaps sit.\n\n" +
        "### Technical Development Map\n" +
        (techGoals ? "Show how each technical goal (" + techGoals + ") is developed across the week. Which sessions target which technical quality and how.\n\n" :
        "How technical quality is developed across the week alongside physical load.\n\n") +
        "### Muscle Group Weekly Map\n" +
        "Which muscle groups are loaded each active day. Identify consecutive-day loading risks.\n\n" +
        "### Load Distribution\n" +
        "Percentage of weekly load per day type. Fatigue curve: when does load peak and trough?";
    }

    else if (section === "match_day") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" + (SPACE_RULE ? SPACE_RULE + "\n\n" : "") + NO_NUTRITION_RULE + "\n\n" +
        (TECH_GOAL_RULE ? TECH_GOAL_RULE + "\n\n" : "") +
        (recoveryCtx ? "RECOVERY CONTEXT:\n" + recoveryCtx + "\n\n" : "") +
        "Write MATCH DAY PROTOCOL for " + position + ".\n\n" +
        "### Pre-Match Activation (start 75 min before kickoff)\n\n" +
        "#### Yesterday & Today\n" +
        "What was trained the day before and how activation accounts for it.\n\n" +
        "#### Phase 1 — General Raise (10 min)\n" +
        "4 exercises. **Name**: *reps/duration*. Coaching cue same line.\n\n" +
        "#### Phase 2 — Position & Technical Primer (8 min)\n" +
        "3 exercises specific to " + position + (techGoals ? " that also activate: " + techGoals : "") + ". **Name**: *reps*. Why this primes this position.\n\n" +
        "#### Phase 3 — CNS Activation (4 min)\n" +
        "2 explosive actions. **Name**: *reps, rest between*.\n\n" +
        "### Post-Match Recovery\n\n" +
        "#### Minutes 0-20 (on site)\n" +
        "4 actions in order: action, duration, reason.\n\n" +
        "#### Hours 1-4 (at home)\n" +
        "- **Contrast shower**: cold temp, hot temp, cycles, total time\n" +
        "- **Foam roll targets**: 4 specific muscles for " + position + ", 60s each\n" +
        "- **Down-regulation**: one breathing or legs-elevated protocol with exact duration\n\n" +
        "#### Day +1 Active Recovery\n" +
        "3 activities, duration, what to avoid.";
    }

    else if (section === "practice_day") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" + (SPACE_RULE ? SPACE_RULE + "\n\n" : "") + NO_NUTRITION_RULE + "\n\n" +
        (TECH_GOAL_RULE ? TECH_GOAL_RULE + "\n\n" : "") +
        (recoveryCtx ? "RECOVERY CONTEXT:\n" + recoveryCtx + "\n\n" : "") +
        "Write TEAM PRACTICE DAY PROTOCOL for " + position + ". " + counts.practice + " practice day(s) per week.\n\n" +
        "### Pre-Practice Add-On (arrive 20 min early)\n\n" +
        "#### Yesterday & Today\n" +
        "What was trained yesterday and how the add-on accounts for it.\n\n" +
        "#### Exercises\n" +
        "4 exercises numbered 01-04. **Bold Name (Variation)**: *X sets of Y reps, Zs rest*. " +
        "What the team warm-up misses for " + position + (techGoals ? " focusing on: " + techGoals : "") + ".\n\n" +
        "### Post-Practice Add-On (stay 20 min after, RPE 6 max)\n\n" +
        "#### Exercises\n" +
        "4 exercises numbered 01-04. **Bold Name (Variation)**: *X sets of Y reps, Zs rest*. " +
        "Technical quality left undertrained by team training" + (techGoals ? " specifically for: " + techGoals : "") + ".\n\n" +
        "### Load Management Rules\n" +
        "3 rules. **Rule name**: condition → exact adjustment → reason.";
    }

    else if (section === "solo_day") {
      const condMins  = Math.round(parseInt(duration) * 0.20);
      const drillMins = Math.round(parseInt(duration) * 0.55);
      const sessions  = counts.solo || 1;

      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" + SOLO_DRILL_RULES + "\n\n" + (SPACE_RULE ? SPACE_RULE + "\n\n" : "") + NO_NUTRITION_RULE + "\n\n" +
        (TECH_GOAL_RULE ? TECH_GOAL_RULE + "\n\n" : "") +
        (recoveryCtx ? "RECOVERY CONTEXT FOR SOLO DAYS:\n" + recoveryCtx + "\n\n" : "") +
        "Write " + sessions + " SOLO TRAINING SESSION(S) for " + position + ". Ball required. Match preparation intensity.\n\n";

      for (var s = 1; s <= sessions; s++) {
        const soloDays = DAY_NAMES.filter(function(d) { return weekPlan[d] === "Solo Training"; });
        const thisDay  = soloDays[s - 1] || soloDays[0] || "a solo day";
        const prevIdx  = DAY_NAMES.indexOf(thisDay);
        const prevDay  = prevIdx >= 0 ? DAY_NAMES[(prevIdx + 6) % 7] : null;
        const prevType = prevDay ? (weekPlan[prevDay] || "Rest Day") : "Rest Day";
        const nextIdx  = prevIdx >= 0 ? (prevIdx + 1) % 7 : -1;
        const nextDay  = nextIdx >= 0 ? DAY_NAMES[nextIdx] : null;
        const nextType = nextDay ? (weekPlan[nextDay] || "Rest Day") : "Rest Day";
        const matchTomorrow = nextType === "Match Day";

        user +=
          "### Session " + s +
          (sessions > 1 ? (s === 1 ? " — Attacking/Offensive Actions" : " — Defensive/Transition Actions") : " — Match Preparation") +
          "\n(Falls on " + thisDay + ")\n\n" +

          "#### Yesterday & Today\n" +
          "Yesterday (" + (prevDay || "previous day") + ") was " + prevType + ". " +
          "2 sentences: which muscles/systems are fatigued and how this session adjusts. " +
          (matchTomorrow ? "Match is tomorrow — cap intensity 75%.\n\n" : "\n\n") +

          "#### Warm-Up (10 min)\n" +
          "Progressive activation building to match intensity.\n" +
          "- 2 min easy movement with direction changes building to 60% pace\n" +
          "- 3 min dynamic mobility: hip flexor lunge walks, lateral leg swings, trunk rotations — ball at feet\n" +
          "- 3 min progressive ball work building to 80% effort\n" +
          "- 2 min: 3 build-up runs at 70%, 85%, 95% over 30m\n\n" +

          "#### Drill 1 — Technical Quality: " + (techGoals ? techGoals.split(',')[0].trim() : "Game Scenario Replication") + " (" + Math.round(drillMins * 0.5) + " min)\n" +
          "**Game scenario**: [exact match situation for " + position + "]\n" +
          "**Drill name**: [specific name]\n" +
          "**Technical goal developed**: [which of the athlete's technical goals this directly trains]\n" +
          "**Setup**: [distances in metres, cone positions, equipment]\n" +
          "**Execution**: numbered steps for each rep\n" +
          "**Coaching cues**: 2 specific technical points\n" +
          "**Physical demand**: [explosive quality trained]\n" +
          "**Volume**: *X sets of Y reps, Z sec rest between reps, W sec rest between sets*\n" +
          (matchTomorrow ? "Match tomorrow — 2 sets maximum.\n\n" : "\n") +

          "#### Drill 2 — Technical Quality: " + (techGoals ? (techGoals.split(',')[1] || techGoals.split(',')[0]).trim() : "Different Physical Quality") + " (" + Math.round(drillMins * 0.5) + " min)\n" +
          "Different technical quality and different match scenario from Drill 1.\n" +
          "Same mandatory format as Drill 1.\n" +
          (matchTomorrow ? "Match tomorrow — 2 sets maximum.\n\n" : "\n") +

          "#### Conditioning Finish (" + condMins + " min)\n" +
          "High intensity. Ball involved where possible. Replicates " + position + " energy demands.\n" +
          "**Drill Name**: *X rounds, Y sec work, Z sec rest*\n" +
          "Exact distances. Energy system targeted.\n" +
          (matchTomorrow ? "Match tomorrow — replace with 8 min technical possession work at 60%.\n\n" : "\n") +

          "#### Cool-Down (5 min)\n" +
          "3 stretches numbered 01-03. **Name**: *duration each side*. Structure targeted and why.\n\n";
      }
    }

    else if (section === "gym_day") {
      const sessions = counts.gym || 1;

      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" + (SPACE_RULE ? SPACE_RULE + "\n\n" : "") + NO_NUTRITION_RULE + "\n\n" +
        (TECH_GOAL_RULE ? TECH_GOAL_RULE + "\n\n" : "") +
        (recoveryCtx ? "RECOVERY CONTEXT FOR GYM DAYS:\n" + recoveryCtx + "\n\n" : "") +
        "Write " + sessions + " GYM SESSION(S) for " + position + ". No ball.\n\n";

      for (var g = 1; g <= sessions; g++) {
        const gymDays  = DAY_NAMES.filter(function(d) { return weekPlan[d] === "Gym / Workout"; });
        const thisDay  = gymDays[g - 1] || gymDays[0] || "a gym day";
        const prevIdx  = DAY_NAMES.indexOf(thisDay);
        const prevDay  = prevIdx >= 0 ? DAY_NAMES[(prevIdx + 6) % 7] : null;
        const prevType = prevDay ? (weekPlan[prevDay] || "Rest Day") : "Rest Day";
        const nextIdx  = prevIdx >= 0 ? (prevIdx + 1) % 7 : -1;
        const nextDay  = nextIdx >= 0 ? DAY_NAMES[nextIdx] : null;
        const nextType = nextDay ? (weekPlan[nextDay] || "Rest Day") : "Rest Day";
        const isConsecutiveGym = prevType === "Gym / Workout";
        const matchTomorrow    = nextType === "Match Day";

        user +=
          "### Session " + g + (sessions > 1 ? (g === 1 ? " — Strength Foundation" : " — Power and Speed") : "") + "\n" +
          "(Falls on " + thisDay + ")\n\n" +
          "#### Yesterday & Today\n" +
          "Yesterday (" + (prevDay || "previous day") + ") was " + prevType + ". " +
          (isConsecutiveGym ? "Consecutive gym day — state which muscle groups are OFF LIMITS today. " : "State which systems are recovered. ") +
          (matchTomorrow ? "Match tomorrow — cap 75%. " : "") +
          "2 sentences maximum.\n\n" +
          "#### Activation Block (8 min)\n" +
          "3 exercises numbered 01-03. **Name**: *reps or duration*. Coaching cue same line.\n\n" +
          "#### Main Block (5 exercises maximum)\n" +
          (isConsecutiveGym ? "STATE AT TOP: muscle groups avoided today and why.\n" : "") +
          (matchTomorrow    ? "STATE AT TOP: match tomorrow — all sets end 2 reps before failure.\n" : "") +
          "5 exercises numbered 01-05. Each: **Exercise Name (Specific Variation)**: *X sets of Y reps, Zs rest, ABCD tempo*. " +
          "One sentence on the specific match situation for " + position + " this directly improves" +
          (techGoals ? " AND which technical goal it supports." : ".") + "\n\n" +
          "#### Power Finisher (8 min)\n" +
          (matchTomorrow ?
            "Match tomorrow — REPLACE with 8 min light mobility and CNS down-regulation.\n\n" :
            "2 exercises numbered 01-02. **Name**: *X sets of Y reps, Zs rest*. Explosive movement pattern for " + position + ".\n\n") +
          "#### Gym-to-Pitch Note\n" +
          "One paragraph. Specific match scenario for " + position + " connected to today's session." +
          (techGoals ? " Include how the gym work directly supports the technical goals: " + techGoals + "." : "") + "\n\n";
      }
    }

    else if (section === "periodization") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + (SPACE_RULE ? SPACE_RULE + "\n\n" : "") + NO_NUTRITION_RULE + "\n\n" +
        (TECH_GOAL_RULE ? TECH_GOAL_RULE + "\n\n" : "") +
        "Write 4-WEEK PERIODIZATION with recovery awareness.\n\n" +
        "Active days: " + [
          counts.match    > 0 ? counts.match    + " match"    : null,
          counts.practice > 0 ? counts.practice + " practice" : null,
          counts.solo     > 0 ? counts.solo     + " solo"     : null,
          counts.gym      > 0 ? counts.gym      + " gym"      : null,
        ].filter(Boolean).join(", ") + "\n\n" +
        (techGoals ? "Technical goals to progress over 4 weeks: " + techGoals + "\n\n" : "") +
        "For each week:\n" +
        "### Week N: NAME\n" +
        "**Theme**: one sentence\n" +
        "**Physical focus**: load and intensity changes\n" +
        (techGoals ? "**Technical focus**: how " + techGoals + " progresses this week\n" : "") +
        "**Recovery focus**: how this week manages fatigue\n" +
        "- **Solo Training**: specific drill intensity change, technical goals prioritised\n" +
        "- **Gym**: specific load change with numbers\n" +
        "- **Practice add-ons**: adjustment\n" +
        "- **Match day**: activation intensity note\n" +
        "**Monitor**: one recovery metric to watch\n\n" +
        "Week 1: Foundation — establish baseline, conservative loads, introduce technical patterns\n" +
        "Week 2: Build — increase volume and intensity, more complex technical scenarios\n" +
        "Week 3: Overload — peak stimulus, maximum drill intensity, highest technical demand\n" +
        "Week 4: Deload — cut volume 40%, maintain intensity, peak for performance\n\n" +
        "End with RECOVERY ARCHITECTURE: 3 most at-risk fatigue points with prevention strategies.";
    }

    else if (section === "benchmarks_warnings") {
      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + (SPACE_RULE ? SPACE_RULE + "\n\n" : "") +
        (TECH_GOAL_RULE ? TECH_GOAL_RULE + "\n\n" : "") +
        "Write PERFORMANCE BENCHMARKS and CRITICAL WARNINGS for " + position + ".\n\n" +
        "### Physical Benchmarks\n" +
        "3 physical tests numbered 01-03. Each:\n" +
        "**Test Name**\n" +
        "- Protocol: exact steps, equipment, measurement\n" +
        "- Baseline (" + fitness + "): expected result now\n" +
        "- 8-week target: realistic improvement\n\n" +
        (techGoals ?
        "### Technical Benchmarks\n" +
        "For each technical goal (" + techGoals + ") — one specific measurable test:\n" +
        "**Technical Test Name**\n" +
        "- Protocol: how to measure this technical quality objectively\n" +
        "- Baseline: what average looks like\n" +
        "- 8-week target: what improvement looks like\n\n" : "") +
        "### Critical Warnings\n" +
        "3 injury risks numbered 01-03. Each:\n" +
        "**Injury Name**\n" +
        "- Mechanism: exactly how it happens for " + position + " with this schedule\n" +
        "- Warning signs: what to feel before serious\n" +
        "- Prevention: 2 specific exercises with sets/reps\n\n" +
        "### Schedule-Specific Overuse Risks\n" +
        "2 patterns causing cumulative overload over 4 weeks.\n\n" +
        "### Age " + age + " Note\n" +
        "How this age affects recovery, injury risk, and adaptation rate for this program.";
    }

    else if (section === "nutrition") {
      const ageNum      = parseInt(age) || 25;
      const hasMatch    = (counts.match || 0) > 0;
      const hasBodyComp = (goals || "").indexOf("Body Composition") !== -1;
      const activeDesc  = [
        counts.match    > 0 ? counts.match    + " match"    : null,
        counts.practice > 0 ? counts.practice + " practice" : null,
        counts.solo     > 0 ? counts.solo     + " solo"     : null,
        counts.gym      > 0 ? counts.gym      + " gym"      : null,
      ].filter(Boolean).join(", ") || "no active days";

      let anchors;
      if (heightCm > 0 && weightKg > 0) {
        const bmr       = Math.round(10 * weightKg + 6.25 * heightCm - 5 * ageNum + (sex === "female" ? -161 : 5));
        const loadScore = (counts.match || 0) * 1.4 + (counts.practice || 0) * 1.0 + (counts.solo || 0) * 0.9 + (counts.gym || 0) * 0.8;
        let mult;
        if      (loadScore <= 2) mult = 1.40;
        else if (loadScore <= 4) mult = 1.55;
        else if (loadScore <= 6) mult = 1.70;
        else                     mult = 1.85;
        const tdee     = Math.round((bmr * mult) / 10) * 10;
        const proteinG = Math.round(weightKg * 1.8);
        const fatG     = Math.round(weightKg * 1.0);
        const carbG    = Math.round((tdee - proteinG * 4 - fatG * 9) / 4);
        const carbKg   = Math.round((carbG / weightKg) * 10) / 10;

        anchors =
          "CALCULATED ANCHORS — present these EXACT numbers. Never recalculate, re-derive, or contradict them:\n" +
          "- BMR (Mifflin-St Jeor — " + (sex || "male") + ", " + ageNum + "y, " + heightCm + " cm, " + weightKg + " kg): " + bmr + " kcal\n" +
          "- Activity multiplier: " + mult.toFixed(2) + " (weekly schedule: " + activeDesc + ")\n" +
          "- Average daily calorie target (TDEE): " + tdee + " kcal\n" +
          "- Protein: " + proteinG + " g/day (1.8 g/kg) — constant every day of the week\n" +
          "- Fat: " + fatG + " g/day (1.0 g/kg)\n" +
          "- Carbohydrate: " + carbG + " g/day average (" + carbKg + " g/kg) — the only macro that moves day to day\n" +
          "- Match / hardest day: ~" + (tdee + 300) + " kcal — the surplus comes from carbs\n" +
          "- Rest day: ~" + (tdee - 350) + " kcal — the reduction comes from carbs and fat, protein untouched\n" +
          (hasBodyComp ? "- Body composition goal selected: also present an optional lean-down track at " + (tdee - 250) + " kcal/day, protein unchanged, with one sentence on the training-quality tradeoff.\n" : "");
      } else {
        anchors =
          "Height and weight were not provided for this athlete. Express every target per kilogram of body weight " +
          "(g/kg and kcal/kg) and instruct the athlete to multiply by their current body weight in kg. Do not invent absolute calorie numbers.";
      }

      user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + anchors + "\n\n" +
        "Write the NUTRITION PROTOCOL for this " + position + ". This is the ONLY nutrition section in the entire program — it must stand alone and be complete. " +
        "Tie reasoning to the athlete's physical goals (" + goals + ") and the match demands of " + position + ". " +
        "Specific foods with portion sizes everywhere — zero 'eat healthy' filler.\n\n" +
        "### Daily Macros\n" +
        "State the daily calorie target and the full protein/carb/fat breakdown from the anchors. One sentence of reasoning per macro tied to " + position + " demands and the stated goals. " +
        "Then show the hard-day vs rest-day calorie adjustment and name exactly which macro moves and by how much.\n\n" +
        (hasMatch ?
          "### Pre-Match Nutrition\n" +
          "- **Meal 3-4 hours before kickoff**: specific foods with portion sizes and total macros (protein g / carbs g / fat g)\n" +
          "- **60 minutes before kickoff**: exact snack and amount, and why it works at that timing\n\n" +
          "### Half-Time\n" +
          "Quick fuel options with exact amounts, and what each does for second-half output at " + position + ".\n\n" +
          "### Post-Match Recovery\n" +
          "The meal within 30-60 minutes of the final whistle: specific foods with portions and total macros. Why this window matters after a " + position + " match load.\n\n"
        :
          "### Hardest Day Fueling\n" +
          "This schedule has no match days, so anchor fueling to the most demanding training day of the week.\n" +
          "- **Meal 3-4 hours before the session**: specific foods with portions and total macros\n" +
          "- **60 minutes before**: exact snack and amount\n" +
          "- **Within 30-60 minutes after**: recovery meal with portions and total macros\n\n"
        ) +
        "### Non-Match Day Guidance\n" +
        (counts.practice > 0 ? "- **Team practice days**: meal timing pattern around the session, with amounts\n" : "") +
        (counts.gym > 0 ? "- **Gym days**: pre-lift and post-lift intake with exact amounts\n" : "") +
        (counts.solo > 0 ? "- **Solo training days**: how to fuel a " + duration + "-minute session\n" : "") +
        "- **Rest days**: what drops, to what number, and what stays constant\n" +
        "Every number must agree with the calculated anchors.";
    }

    else {
      res.status(400).end("Unknown section: " + section);
      return;
    }

    // ── PROGRESSION INJECTION ─────────────────────────────────────────────────
    // If the client sent a previous program for this section, append a hard
    // mandate at the end of the prompt so the AI builds forward, not sideways.
    if (previousProgram) {
      user +=
        "\n\n" +
        "══════════════════════════════════════════════════\n" +
        "PROGRESSION MANDATE — HIGHEST PRIORITY INSTRUCTION\n" +
        "══════════════════════════════════════════════════\n" +
        "This is the UPDATED version of this section for a returning athlete who has " +
        "completed a full program cycle and is ready for a harder stimulus.\n\n" +
        "Their PREVIOUS version of this section read:\n\n" +
        "[PREVIOUS PROGRAM START]\n" +
        previousProgram + "\n" +
        "[PREVIOUS PROGRAM END]\n\n" +
        "MANDATORY REQUIREMENTS — ALL MUST BE MET:\n" +
        "1. Zero repeated exercises, drills, or session structures from the previous program above\n" +
        "2. Increase all loads explicitly: more sets, stricter rest, more reps, or more complex variations than the previous version\n" +
        "3. Introduce at least 2 exercises or drills not present in any form in the previous version\n" +
        "4. Open this section with one sentence acknowledging the progression: \"Building from your previous cycle...\"\n" +
        "5. The athlete is neurologically adapted to the previous program — the new stimulus must be meaningfully different\n" +
        (progressionContext ? "6. Profile changes to address this cycle:\n" + progressionContext + "\n" : "") +
        "\nBUILD FORWARD, not sideways. This must be an unmistakable upgrade.";
    }
    // ─────────────────────────────────────────────────────────────────────────

    const payload = JSON.stringify({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user }
      ],
      max_tokens: 8000,
      temperature: 0.7,
      stream: true
    });

    const options = {
      hostname: "openrouter.ai",
      path:     "/api/v1/chat/completions",
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Authorization":  "Bearer " + apiKey,
        "HTTP-Referer":   "https://pitchcondition.vercel.app",
        "X-Title":        "Pitch Condition",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const upstream = https.request(options, function(openRouterRes) {
      res.setHeader("Content-Type",  "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection",    "keep-alive");
      res.status(openRouterRes.statusCode);
      openRouterRes.pipe(res);
    });

    upstream.on("error", function(err) {
      if (!res.headersSent) res.status(502).end("Upstream error: " + err.message);
      else res.end();
    });

    upstream.write(payload);
    upstream.end();
  });

  req.on("error", function(err) {
    if (!res.headersSent) res.status(400).end("Request error: " + err.message);
  });
};
