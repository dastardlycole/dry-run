# Dry Run: final demo script (about 3 minutes)

The video has four clear MongoDB moments and four clear Gemini moments, each named on screen with a caption.

## Before recording
- Open https://dry-runserver-production.up.railway.app in Chrome with the sound on. Allow the microphone when asked.
- Fill in the weak junctions first: drive **Wanstead Route 1** twice and skip the mirror check (M) before the first turn both times, pressing Enter to end each drive.
- Log into MongoDB Atlas in another tab for clip H.
- Record with Win+Alt+R in short clips, then edit in Clipchamp. Record the narration last, over the clips. Keep the examiner's voice in, turned down under the narration.

---

### 1. The problem
**Clip:** title card: *"Dry Run: practise your real driving test"*
> "In the UK, under half of learner drivers pass their test, and a fail means waiting months for another slot. Most people take their test on roads they've never driven. Dry Run fixes that."

### 2. Your test area
**Clip A:** start card → type **Goodmayes** → the centre is found → the route list appears → pick a route → the streets load.
> "Type your test centre or postcode. Dry Run builds the real streets around it from OpenStreetMap, filling the gaps with Overture's AI-traced buildings, then makes test-style routes through real roundabouts, lights and give-ways."

### 3. The mock test
**Clip B:** **Wanstead Route 1** → the examiner's opening line → press **T** → the 'tell me' question → answer out loud → the verdict.
*Captions:* **Gemini TTS: examiner voice** · **Gemini Live API: spoken 'tell me' question**
> "The examiner speaks with a Gemini text-to-speech voice, and asks a 'tell me' question, just like the real test. I answer out loud, and the Gemini Live API judges my answer against the official DVSA one, live."

**Clip C:** driving with directions playing → signal **without** pressing M → the fault flashes → the **Examiner's notes** box, with the explanation arriving.
*Caption:* **Fault saved to MongoDB Atlas**
> "Then I drive. Faults come from rules in code, marked exactly like the real test sheet. The AI never decides a fault. Here I signal without checking my mirror. It's marked instantly and saved to MongoDB Atlas, and moments later the examiner explains why."

**Clip D:** go straight past the first turn → "That's fine. Follow the road and I'll direct you back to the route." → the new blue arrows.
> "Miss a turn? On the real test that's not a fault, and it isn't here either. The examiner calmly finds a way back."

### 4. The debrief
**Clip E:** pull up or press Enter → the result screen with faults pinned on the map, and the examiner's spoken summary playing.
**Clip F:** scroll the debrief: explanations with **Highway Code** chips.
*Captions:* **MongoDB Atlas Vector Search with auto-embedding + hybrid search** · **Gemini (Argon): explanations, checked against the Highway Code**
> "At the end, the examiner reads my result aloud, again with Gemini's voice, and I get a full debrief. To explain each fault we use RAG. The Highway Code lives in MongoDB Atlas with automatic embeddings, and hybrid search finds the right rules for each mistake. Gemini writes the explanation from them, and a checker throws out anything that doesn't cite a real rule, so it can't make one up."

### 5. Coaching
**Clip G:** switch to **Practise** → make a fault → the instructor's spoken tip. Then the start card: **"your weak junctions"** → press **Practise** on it → the car starts just before that junction.
*Captions:* **Gemini TTS: instructor coaching** · **MongoDB aggregation: your weak junctions**
> "In practice mode, an instructor coaches me out loud as I go. And because every fault is stored in MongoDB Atlas, an aggregation groups my mistakes across all my drives. If I keep making the same mistake at the same junction, it shows up as a weak junction, and one click takes me straight back there to practise it."

### 6. Responsible, real data, and the close
**Clip H (Atlas montage, about 8 s):** `fault_events` documents → the guidance collection's vector and search indexes → Stream Processing showing **Started**.
*Caption:* **MongoDB Atlas Stream Processing: live fault counts per junction**
**End card:** the live link, plus *MongoDB: Atlas, Stream Processing, Vector Search + auto-embedding, Atlas Search, aggregations · Gemini: Live API, TTS, Argon*
> "Atlas Stream Processing turns every saved fault into live counts per junction. There are no accounts, no cameras and no tracking: the only location used is the test centre you type. It's all built on real open data, and it's live now. Next: every test centre in the country, and accounts for driving instructors. Dry Run: practise your real test before you take it."

---

## Clip checklist
| Clip | Where | Shows |
|---|---|---|
| A | Start card, Goodmayes | Type your centre, routes |
| B | Wanstead Route 1 | Examiner voice + Gemini Live 'tell me' |
| C | Wanstead Route 1 | Fault marked, saved, explained |
| D | Wanstead Route 1, first turn | Missed turn, the examiner recovers |
| E | Wanstead result | Result + spoken summary |
| F | Wanstead debrief | Highway Code citations |
| G | Practice + start card | Spoken tip, weak junctions |
| H | Atlas UI | `fault_events`, indexes, Stream Processing |

The narration is about 430 words, which is roughly 3 minutes at a calm pace. If it runs long, cut clip D first.
