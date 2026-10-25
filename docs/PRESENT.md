# Dry Run: presentation cheat sheet

## Kit
- [ ] Friend's laptop (not mine), charger plugged in
- [ ] Chrome open: live site + Encode Hub tab + deck PDF
- [ ] Sound tested on the venue speakers, mic allowed in Chrome
- [ ] Wanstead Route 1 driven twice (skip M before the first turn) so "your weak junctions" is filled
- [ ] Backup: demo video downloaded on the laptop

**Links**
- Live: https://dry-runserver-production.up.railway.app
- Encode Hub: https://dry-runserver-production.up.railway.app/?centre=encode-hub&mode=free
- Wanstead Route 1: https://dry-runserver-production.up.railway.app/?route=auto-1
- Code: https://github.com/dastardlycole/dry-run

**If the site or Wi-Fi fails:** switch to the video, no apology: "Here's a recorded run."

---

## Run order
1. **Hook (Encode Hub):** "This is the building we're in, rebuilt from open map data. Now imagine it's the roads around *your* test centre." Drive 10 s, press **C**, show the sign.
2. **Problem:** under half of UK learners pass, a fail means months of waiting, and most have never driven their test roads.
3. **Your test area:** type **Goodmayes**. The real DVSA centre is found, with test-style routes through real roundabouts, lights and give-ways.
4. **Mock test (Wanstead Route 1):**
   - **T** → 'tell me' question, answer out loud. "Gemini Live judges it against the official DVSA answer."
   - Signal **without M** → fault + Examiner's notes. "Code marks the fault, it's saved to MongoDB Atlas, Gemini explains it."
   - Go **straight past the first turn** → "That's fine…". "Missing a turn isn't a fault on the real test, and the examiner finds a way back."
5. **Debrief (Enter):** "RAG: the Highway Code lives in Atlas with automatic embeddings, hybrid search finds the right rules, Gemini writes the explanation, and a checker drops anything that doesn't cite a real rule."
6. **Weak junctions (Change route):** "Every fault is in Atlas. An aggregation groups my mistakes across drives, so it knows where I keep slipping up."
7. **Close:** "The AI can't mark you and can't invent a rule. No accounts, no tracking. Next: every test centre, and driving instructors."

**If something goes wrong:** 'tell me' silent → say what it does and drive on. Explanation slow → keep talking, it's in the debrief anyway.

---

## Tech in one breath
- **MongoDB Atlas:** live fault saving (geo-indexed), Stream Processing (live fault counts per junction), Vector Search with automated embedding (voyage-4), Atlas Search, `$rankFusion` hybrid search, `$rerank` (rerank-2.5), aggregations (weak junctions), STATS19 crash data.
- **Gemini:** Live API `gemini-3.8-live` ('tell me', one-use token), `gemini-4-argon` (explanations + summary, citation-checked), TTS `gemini-3.8-flash-tts` (examiner voice, coaching tips, spoken summary).
- **Data:** OpenStreetMap, Overture Maps, DVSA centres + 'tell me' questions, Highway Code, DfT STATS19.
- **Sim:** Three.js + Rapier physics in the browser, 11 fault rules in code.

---

## Q&A

**Are these the real test routes?**
No. DVSA hasn't published routes since 2010. We build test-style loops on the real roads around the centre, with the same kinds of junctions. What carries over is knowing the roads.

**Does driving with a keyboard really help?**
It doesn't teach car control. It teaches what learners actually fail on: mirrors before signalling, observation at junctions, the right signal at roundabouts, and knowing the roads.

**How accurate is the marking?**
11 rules from the DVSA marking sheet, written as code and tested. The same drive always gets the same faults. Not yet: other traffic, pedestrians, manoeuvres.

**Why doesn't the AI mark faults?**
Trust and consistency. A mark has to be fair and repeatable. Code decides, AI explains.

**How do you stop the AI making things up?**
RAG over the real Highway Code in Atlas, then a citation checker. An explanation only shows if it cites rules it was given; otherwise it's sent back once, then dropped.

**Why MongoDB?**
One platform for live fault data, vector + text search for RAG, Stream Processing and aggregations. No separate vector database or queue.

**What's Stream Processing for?**
Live fault counts per junction: the base for the instructor side ("where do my learners keep failing"). The instructor view is the next step.

**Privacy?**
No accounts, no camera, no location tracking. A random browser ID. The only place used is the centre you type.

**What if the map data is missing or wrong?**
Gaps in buildings are filled with Overture's AI-traced outlines. Missing road widths are guessed and flagged as low confidence. Routes fall back to fewer junction types on odd maps. Faults come from rules, so bad AI output can't change a mark.

**Who pays?**
Learners pay a little per mock test, far less than a failed test plus a rebook. Driving schools pay a subscription to set practice between lessons.

**Have you tested it with learners?**
(Be honest.) "Not yet. That's the next step, starting with learners at Goodmayes and Wanstead."

**Does it work for any test centre?**
Any UK postcode can be built live in about a minute, but it depends on public map servers, so the demo uses pre-built centres.

**What was hardest?**
Turning messy OpenStreetMap data into drivable roads and routes, and making the marking fair. Missing a turn used to give a false fault; that was fixed last night.

**What's next?**
Every test centre pre-built, other traffic on the roads, instructor accounts, and testing with real learners.
