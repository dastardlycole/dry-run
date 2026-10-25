# Dry Run: final demo script (about 3 minutes)

Two kinds of footage:
- **ON CAMERA:** you, talking to a phone camera. These carry the "how might we" story.
- **SCREEN:** clips of the live site and Atlas, with your narration recorded over them afterwards.

Small corner labels name the MongoDB and Gemini features as they appear, for judges skimming for sponsor tech.

## Before recording
- Open https://dry-runserver-production.up.railway.app in Chrome with the sound on. Allow the microphone when asked.
- Fill in the weak junctions first: drive **Wanstead Route 1** twice and skip the mirror check (M) before the first turn both times, pressing Enter to end each drive.
- Log into MongoDB Atlas in another tab for clip H.
- **Screen clips:** Win+Alt+R (Game Bar) in short clips. **On-camera bits:** a phone at eye level, near a window, one line per take. Edit in Clipchamp. Record the screen narration last, keeping the examiner's voice in, turned down under it.

---

### 1. Opening (ON CAMERA, about 20 s)
> "Meet a learner like Amara. Her test is at Goodmayes in six weeks, and like most learners she's never driven the roads she'll be tested on. Under half of UK learners pass, and a fail means waiting months for another slot. So I asked: how might we let her rehearse her real test, before test day? This is Dry Run."

### 2. Your test area
**ON CAMERA (about 5 s):**
> "First: how might we let learners rehearse their own test roads?"

**SCREEN, clip A:** start card → type **Goodmayes** → the centre is found → the route list appears → pick a route → the streets load.
> "Type your test centre. Dry Run builds the real streets from OpenStreetMap and Overture, with test-style routes through real roundabouts, lights and give-ways."

### 3. The mock test
**ON CAMERA (about 5 s):**
> "Next: how might we make a mock test feel like the real thing, without a real examiner?"

**SCREEN, clip B:** **Wanstead Route 1** → the examiner's opening line → press **T** → the 'tell me' question → answer out loud → the verdict.
*Labels:* **Gemini TTS** · **Gemini Live API**
> "The examiner speaks with a Gemini text-to-speech voice, and asks a 'tell me' question, just like the real test. I answer out loud, and the Gemini Live API judges my answer against the official DVSA one, live."

**SCREEN, clip C:** driving with directions playing → signal **without** pressing M → the fault flashes → the **Examiner's notes** box, with the explanation arriving.
*Label:* **Saved to MongoDB Atlas**
> "Then I drive. Faults come from rules in code, marked exactly like the real test sheet. The AI never decides a fault. Here I signal without checking my mirror. It's marked instantly and saved to MongoDB Atlas, and moments later the examiner explains why."

**SCREEN, clip D (about 5 s):** go straight past the first turn → "That's fine. Follow the road and I'll direct you back to the route." → the new blue arrows.
> "And if I miss a turn, just like the real test, it's not a fault. The examiner finds a way back."

### 4. The debrief
**ON CAMERA (about 5 s):**
> "Then: how might we explain mistakes with advice learners can trust?"

**SCREEN, clip E:** pull up or press Enter → the result screen with faults pinned on the map, and the examiner's spoken summary playing.
**SCREEN, clip F:** scroll the debrief: explanations with **Highway Code** chips.
*Labels:* **Atlas Vector Search + auto-embedding** · **Hybrid search** · **Gemini (Argon)**
> "At the end, the examiner reads my result aloud, again with Gemini's voice, and I get a full debrief. To explain each fault we use RAG. The Highway Code lives in MongoDB Atlas with automatic embeddings, and hybrid search finds the right rules for each mistake. Gemini writes the explanation from them, and a checker throws out anything that doesn't cite a real rule, so it can't make one up."

### 5. Coaching
**ON CAMERA (about 5 s):**
> "And finally: how might we show learners the mistakes they keep repeating?"

**SCREEN, clip G:** switch to **Practise** → make a fault → the instructor's spoken tip. Then the start card: **"your weak junctions"** → press **Practise** on it → the car starts just before that junction.
*Labels:* **Gemini TTS** · **MongoDB aggregation**
> "In practice mode, an instructor coaches me out loud as I go. And because every fault is stored in MongoDB Atlas, an aggregation groups my mistakes across all my drives. If I keep making the same mistake at the same junction, it shows up as a weak junction, and one click takes me straight back there to practise it."

### 6. Under the hood
**SCREEN, clip H (Atlas montage, about 8 s):** `fault_events` documents → the guidance collection's vector and search indexes → Stream Processing showing **Started**.
*Label:* **Atlas Stream Processing**
> "Atlas Stream Processing turns every saved fault into live counts per junction, all built on real open data."

### 7. Close (ON CAMERA, about 15 s)
> "There are no accounts, no cameras and no tracking: the only location used is the test centre you type. Dry Run is live now. Next: every test centre in the country, and accounts for driving instructors. Dry Run: practise your real test before you take it."

**End card:** the live link, plus *MongoDB: Atlas, Stream Processing, Vector Search + auto-embedding, Atlas Search, aggregations · Gemini: Live API, TTS, Argon*

---

## Shot list
| Shot | Type | Where | Shows |
|---|---|---|---|
| 1 | On camera | — | Amara + "how might we let her rehearse her real test?" |
| 2 | On camera | — | HMW: own test roads |
| A | Screen | Start card, Goodmayes | Type your centre, routes |
| 3 | On camera | — | HMW: real-feeling mock test |
| B | Screen | Wanstead Route 1 | Examiner voice + Gemini Live 'tell me' |
| C | Screen | Wanstead Route 1 | Fault marked, saved, explained |
| D | Screen | Wanstead Route 1, first turn | Missed turn, the examiner recovers |
| 4 | On camera | — | HMW: advice you can trust |
| E | Screen | Wanstead result | Result + spoken summary |
| F | Screen | Wanstead debrief | Highway Code citations |
| 5 | On camera | — | HMW: repeated mistakes |
| G | Screen | Practice + start card | Spoken tip, weak junctions |
| H | Screen | Atlas UI | `fault_events`, indexes, Stream Processing |
| 7 | On camera | — | Responsibility, what's next, sign-off |

About 3 minutes in total. If it runs long, cut clip D first, then shorten the part 4 narration.
