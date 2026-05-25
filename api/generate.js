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

 const apiKey = process.env.OPENROUTER_API_KEY;
 if (!apiKey) {
   res.status(500).end("OPENROUTER_API_KEY environment variable is not set");
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

   const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
   const scheduleLines = schedule.split("\n");
   const weekPlan = {};
   scheduleLines.forEach(function(line) {
     const parts = line.split(": ");
     if (parts.length === 2) weekPlan[parts[0].trim()] = parts[1].trim();
   });

   function getRecoveryContext(targetDayType) {
     const targetDays = DAY_NAMES.filter(function(d) {
       return weekPlan[d] === targetDayType;
     });
     if (targetDays.length === 0) return "";
     const contexts = [];
     targetDays.forEach(function(day) {
       const dayIdx = DAY_NAMES.indexOf(day);
       const prevIdx = (dayIdx + 6) % 7;
       const prevDay = DAY_NAMES[prevIdx];
       const prevType = weekPlan[prevDay] || "Rest Day";
       const nextIdx = (dayIdx + 1) % 7;
       const nextDay = DAY_NAMES[nextIdx];
       const nextType = weekPlan[nextDay] || "Rest Day";
       let note = "On " + day + " (" + targetDayType + "):\n";
       note += "- Yesterday (" + prevDay + ") was: " + prevType + "\n";
       note += "- Tomorrow (" + nextDay + ") will be: " + nextType + "\n";
       if (prevType === "Gym / Workout") {
         note += "- RECOVERY RULE: Heavy gym yesterday. Avoid heavy lower body loading today. Shift to upper body, core, or technical work with minimal ground impact. No squats, deadlifts, lunges, or plyometrics.\n";
       } else if (prevType === "Match Day") {
         note += "- RECOVERY RULE: Match yesterday. " + position + " sore muscles: " + getPositionSoreMuscles(position) + ". Reduce intensity 30-40%. No explosive work. Focus on mobility, light technical work, blood flow.\n";
       } else if (prevType === "Solo Training") {
         note += "- RECOVERY RULE: Solo session yesterday. Moderate lower body fatigue. Avoid high-volume sprint work if another solo day, or focus on strength not power if gym day.\n";
       } else if (prevType === "Team Practice") {
         note += "- RECOVERY RULE: Team practice yesterday. Reduce total running volume 20% if solo, or keep gym focused on upper body and core rather than heavy legs.\n";
       } else {
         note += "- RECOVERY RULE: Rest day yesterday. Full recovery. Today at full planned intensity.\n";
       }
       if (nextType === "Match Day") {
         note += "- LOOK AHEAD: Match tomorrow. Cap intensity 75%. No eccentric-heavy exercises. No max-effort sprints. End session feeling fresh.\n";
       } else if (nextType === "Gym / Workout") {
         note += "- LOOK AHEAD: Gym tomorrow. Avoid loading the same muscle groups that gym session will target.\n";
       }
       if (targetDayType === "Gym / Workout" && prevType === "Gym / Workout") {
         note += "- CONSECUTIVE GYM RULE: Yesterday also gym. Today MUST train completely different muscle groups. State which groups are avoided and why.\n";
       }
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
     "- Transfer explanation on the same line after italics.\n" +
     "- No placeholders. Every number explicit.";

   const RECOVERY_RULE =
     "RECOVERY AWARENESS (apply to every session):\n" +
     "1. Start each session with '#### Yesterday & Today' — state what was trained yesterday and how today adjusts.\n" +
     "2. Gym lower body yesterday: no squats, deadlifts, lunges, plyometrics. Shift to upper body, core, technical.\n" +
     "3. Match yesterday: reduce intensity 30-40%, acknowledge sore muscles, focus on mobility and light technical work.\n" +
     "4. Consecutive gym days: second day trains different muscle groups — state what is avoided.\n" +
     "5. Solo sessions complement gym — if gym loaded hamstrings, solo avoids hamstring-dominant sprinting.\n" +
     "6. Match tomorrow: cap at 75%, no eccentric-heavy work, player finishes feeling fresh.";

   const SOLO_DRILL_RULES =
     "SOLO DRILL QUALITY RULES — NON-NEGOTIABLE:\n" +
     "1. BANNED drills — never include these: figure 8 dribbling, cone weaves, stationary ball mastery, juggling circuits, slow technical drills, generic passing against a wall at walking pace.\n" +
     "2. Every drill must replicate a SPECIFIC IN-GAME SITUATION. Name the game scenario before describing the drill.\n" +
     "3. Every drill must involve EXPLOSIVE INTENSITY — sprinting, rapid acceleration, sharp deceleration, or powerful striking.\n" +
     "4. Every drill must have a FATIGUE COMPONENT — done in sets with short rest or preceded by a sprint.\n" +
     "5. Drill format MANDATORY:\n" +
     "   - Game scenario: the exact match situation this replicates\n" +
     "   - Setup: distances in metres, number of cones, markers, equipment\n" +
     "   - Execution: numbered steps\n" +
     "   - Coaching cues: 2 specific technical points\n" +
     "   - Physical demand: athletic quality being trained\n" +
     "   - Volume: sets x reps, rest between reps, rest between sets\n" +
     "6. Good drill examples (adapt for position, do not copy verbatim):\n" +
     "   - Explosive run onto through ball: sprint 20m from standing start, receive self-served ball on run, finish.\n" +
     "   - Press trigger sprint: explode 15m to cone simulating press, decelerate, backpedal 8m to reset.\n" +
     "   - Crossing at full pace: sprint full channel 35m, receive ball rolled into path, deliver cross without breaking stride.\n" +
     "   - Receive under pressure and turn: receive ball to feet, first touch away from cone 1m behind, accelerate 10m.\n" +
     "   - Finishing under fatigue: after 5 shuttle sprints 20m each, immediately receive and finish.\n" +
     "   - Recovery sprint and block: sprint 25m wide, plant, sprint back 15m to cut off cross angle.\n" +
     "7. Zero repeated drills across sessions.";

   const system =
     "You are an elite soccer performance coach. You write match-preparation training sessions, not recreational ball work. " +
     "Every solo session feels like preparing for the next game. Intensity is always high. " +
     "Every drill replicates a real match situation. No filler. No generic content.";

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
       "5 muscles/groups: name, why critical, consequence of weakness.\n\n" +
       "### Match Metrics\n" +
       "Total distance, high-intensity distance, sprint count, avg sprint distance, contacts. Real data ranges.\n\n" +
       "### Elite vs Average\n" +
       "3 physical qualities separating elite from average at " + position + ". Specific and blunt.\n\n" +
       "### Weekly Recovery Profile\n" +
       "2 highest fatigue accumulation points in this schedule. Muscles at risk of overuse.\n\n" +
       "### Age Note\n" +
       "How age " + age + " affects recovery between sessions for this schedule.";
   }

   else if (section === "weekly_logic") {
     user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
       "Write WEEKLY LOAD LOGIC with full recovery awareness.\n\n" +
       "### Daily Schedule\n" +
       "List Mon-Sun. Each line: **Day**: Type — Focus (5 words) — Load: Low/Medium/High — Recovery status from previous day\n\n" +
       "### Load Structure\n" +
       "3 paragraphs: (1) how match day anchors the week, (2) how gym and solo avoid overlap, (3) where recovery gaps sit and why.\n\n" +
       "### Muscle Group Weekly Map\n" +
       "Which muscle groups are loaded each active day. Identify consecutive-day loading risks and how the program manages them.\n\n" +
       "### Load Distribution\n" +
       "Percentage of weekly load per day type. Fatigue curve: when does load peak and trough?";
   }

   else if (section === "match_day") {
     user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" +
       (recoveryCtx ? "RECOVERY CONTEXT:\n" + recoveryCtx + "\n\n" : "") +
       "Write MATCH DAY PROTOCOL for " + position + ".\n\n" +
       "### Pre-Match Activation (start 75 min before kickoff)\n\n" +
       "#### Yesterday & Today\n" +
       "What was trained the day before and how activation accounts for it.\n\n" +
       "#### Phase 1 — General Raise (10 min)\n" +
       "4 exercises. **Name**: *reps/duration*. Coaching cue same line.\n\n" +
       "#### Phase 2 — Position Primer (8 min)\n" +
       "3 exercises specific to " + position + ". **Name**: *reps*. Why this primes this position.\n\n" +
       "#### Phase 3 — CNS Activation (4 min)\n" +
       "2 explosive actions. **Name**: *reps, rest between*. Nervous system quality fired.\n\n" +
       "### Post-Match Recovery\n\n" +
       "#### Minutes 0-20 (on site)\n" +
       "4 actions in order: action, duration, reason.\n\n" +
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
       (recoveryCtx ? "RECOVERY CONTEXT:\n" + recoveryCtx + "\n\n" : "") +
       "Write TEAM PRACTICE DAY PROTOCOL for " + position + ". " + counts.practice + " practice day(s) per week.\n\n" +
       "### Pre-Practice Add-On (arrive 20 min early)\n\n" +
       "#### Yesterday & Today\n" +
       "What was trained yesterday and how the add-on accounts for it.\n\n" +
       "#### Exercises\n" +
       "4 exercises numbered 01-04. **Bold Name (Variation)**: *X sets of Y reps, Zs rest*. " +
       "What the team warm-up misses for " + position + " and how this fixes it.\n\n" +
       "### Post-Practice Add-On (stay 20 min after, RPE 6 max)\n\n" +
       "#### Exercises\n" +
       "4 exercises numbered 01-04. **Bold Name (Variation)**: *X sets of Y reps, Zs rest*. " +
       "Physical quality team training leaves undertrained for " + position + ".\n\n" +
       "### Load Management Rules\n" +
       "3 rules. **Rule name**: condition → exact adjustment → reason.";
   }

   else if (section === "solo_day") {
     const condMins  = Math.round(parseInt(duration) * 0.20);
     const drillMins = Math.round(parseInt(duration) * 0.55);
     const sessions  = counts.solo || 1;

     user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" + SOLO_DRILL_RULES + "\n\n" +
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
         (matchTomorrow ? "Match is tomorrow — cap intensity 75% and state this explicitly.\n\n" : "\n\n") +

         "#### Warm-Up (10 min)\n" +
         "Progressive activation building to match intensity. Not generic jogging.\n" +
         "- 2 min easy movement with direction changes building to 60% pace\n" +
         "- 3 min dynamic mobility: hip flexor lunge walks, lateral leg swings, trunk rotations — ball at feet\n" +
         "- 3 min progressive ball work building to 80% effort: driven passes, building pace\n" +
         "- 2 min: 3 build-up runs at 70%, 85%, 95% over 30m\n\n" +

         "#### Drill 1 — Game Scenario Replication (" + Math.round(drillMins * 0.5) + " min)\n" +
         "Replicate a high-frequency match action for " + position + ".\n" +
         "**Game scenario**: [exact match situation]\n" +
         "**Drill name**: [specific name]\n" +
         "**Setup**: [distances in metres, cone positions, equipment]\n" +
         "**Execution**: numbered steps for each rep\n" +
         "**Coaching cues**: 2 specific technical points\n" +
         "**Physical demand**: [explosive quality trained]\n" +
         "**Volume**: *X sets of Y reps, Z sec rest between reps, W sec rest between sets*\n" +
         (matchTomorrow ? "Match tomorrow — 2 sets maximum, 60% intensity.\n\n" : "\n") +

         "#### Drill 2 — Different Physical Quality (" + Math.round(drillMins * 0.5) + " min)\n" +
         "Different physical quality and different match scenario from Drill 1. Higher intensity than Drill 1.\n" +
         "Same mandatory format as Drill 1.\n" +
         (matchTomorrow ? "Match tomorrow — 2 sets maximum, full rest between sets.\n\n" : "\n") +

         "#### Conditioning Finish (" + condMins + " min)\n" +
         "High intensity. Ball involved where possible. Replicates " + position + " energy demands in final 20 min of match.\n" +
         "**Drill Name**: *X rounds, Y sec work, Z sec rest*\n" +
         "Exact distances. Energy system targeted. Why it matches " + position + " match demands.\n" +
         (matchTomorrow ? "Match tomorrow — replace with 8 min technical possession work at 60% intensity.\n\n" : "\n") +

         "#### Cool-Down (5 min)\n" +
         "3 stretches numbered 01-03. **Name**: *duration each side*. Structure targeted and why.\n" +
         "At least one stretch addresses primary muscle group loaded by Drill 1 or 2.\n\n";
     }

     if (sessions > 1) {
       user += "FINAL CHECK: Drill 1 and Drill 2 must be completely different across all sessions. No repeated drills.";
     }
   }

   else if (section === "gym_day") {
     const sessions = counts.gym || 1;

     user = athlete + "\n\n" + FORMAT_RULE + "\n\n" + RECOVERY_RULE + "\n\n" +
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
         (isConsecutiveGym ? "Consecutive gym day — state which muscle groups are OFF LIMITS today and confirm today trains different groups. " : "State which systems are recovered and how today builds on that. ") +
         (matchTomorrow ? "Match tomorrow — cap 75%, no eccentric-heavy work. " : "") +
         "2 sentences maximum.\n\n" +
         "#### Activation Block (8 min)\n" +
         "3 exercises numbered 01-03. **Name**: *reps or duration*. Coaching cue same line.\n\n" +
         "#### Main Block (5 exercises maximum)\n" +
         (isConsecutiveGym ? "STATE AT TOP: muscle groups avoided today and why.\n" : "") +
         (matchTomorrow    ? "STATE AT TOP: match tomorrow — all sets end 2 reps before failure.\n" : "") +
         "5 exercises numbered 01-05. Each: **Exercise Name (Specific Variation)**: *X sets of Y reps, Zs rest, ABCD tempo*. " +
         "One sentence on the specific match situation for " + position + " this directly improves.\n\n" +
         "#### Power Finisher (8 min)\n" +
         (matchTomorrow ?
           "Match tomorrow — REPLACE with 8 min light mobility and CNS down-regulation. State this explicitly.\n\n" :
           "2 exercises numbered 01-02. **Name**: *X sets of Y reps, Zs rest*. Explosive movement pattern for " + position + ".\n\n") +
         "#### Gym-to-Pitch Note\n" +
         "One paragraph. Specific match scenario for " + position + " connected directly to today's session. What it protects and prepares in the weekly plan.\n\n";
     }
   }

   else if (section === "periodization") {
     user = athlete + "\n\n" + FORMAT_RULE + "\n\n" +
       "Write 4-WEEK PERIODIZATION with recovery awareness.\n\n" +
       "Active days: " + [
         counts.match    > 0 ? counts.match    + " match"    : null,
         counts.practice > 0 ? counts.practice + " practice" : null,
         counts.solo     > 0 ? counts.solo     + " solo"     : null,
         counts.gym      > 0 ? counts.gym      + " gym"      : null,
       ].filter(Boolean).join(", ") + "\n\n" +
       "For each week:\n" +
       "### Week N: NAME\n" +
       "**Theme**: one sentence\n" +
       "**Recovery focus**: how this week manages fatigue\n" +
       "- **Solo Training**: specific drill intensity change, game scenarios prioritised\n" +
       "- **Gym**: specific load change with numbers, muscle group rotation notes\n" +
       "- **Practice add-ons**: adjustment\n" +
       "- **Match day**: activation intensity note\n" +
       "**Monitor**: one recovery metric to watch\n\n" +
       "Week 1: Foundation — establish baseline, learn patterns, conservative loads\n" +
       "Week 2: Build — increase volume and intensity, more complex game scenarios\n" +
       "Week 3: Overload — peak stimulus, maximum drill intensity, highest gym loads\n" +
       "Week 4: Deload — cut volume 40%, maintain intensity, peak for performance\n\n" +
       "End with RECOVERY ARCHITECTURE: 3 most at-risk cumulative fatigue points with prevention strategies.";
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
       "- Warning signs: what to feel before serious\n" +
       "- Prevention: 2 specific exercises with sets/reps\n\n" +
       "### Schedule-Specific Overuse Risks\n" +
       "2 patterns causing cumulative overload over 4 weeks. Name muscles, mechanism, adjustment.\n\n" +
       "### Age " + age + " Note\n" +
       "How this age affects recovery, injury risk, and adaptation rate for this program.";
   }

   else {
     res.status(400).end("Unknown section: " + section);
     return;
   }

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
       "HTTP-Referer":   "https://soccer-pharaoh.vercel.app",
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
