# Demo script — 3 to 5 minutes

Only record the live integration segments after credentials are configured and those runs actually pass. Never replace missing runs with invented logs.

**0:00–0:30 — The hook.** Show the room. “EscapeProof is an AI-authored escape room that must demonstrate its own intended escape before publication. Codex built the application; Kane checks it in the browser.”

**0:30–1:10 — Play.** Begin the expedition. Inspect the notebook, derive the combination, unlock the drawer, collect the key, and escape. Briefly show the inventory and timer.

**1:10–1:40 — Create.** Open the operator workshop and generate a draft from a short inventor-workshop theme. Show the resulting immutable revision and source label. Explain that the agent creates puzzle data, not arbitrary code.

**1:40–2:10 — Break honestly.** Use Developer fault injection to remove the clue from a new revision. Preview the blank notebook. Identify this as a deliberate demonstration fault.

**2:10–3:10 — Verify and repair.** Run Kane. Show real browser/check progress and the failed clue assertion. Show the failure reaching the repair agent, the revision change, and the before/after clue text. Both checks rerun against the repaired revision. If runs take longer, edit waiting time out of the recording and label the time cut; do not misrepresent duration.

**3:10–3:50 — Publish.** Show both checks passing. Publish the exact verified revision, then start a fresh visitor session and complete it. Show the real result/evidence links.

**3:50–4:15 — Explain the claim.** “This checks the intended route and accessible clues. It does not guarantee fairness or eliminate every shortcut.” Point to the public repository and setup instructions.

Before recording: rehearse on a newly generated room, confirm sufficient Kane credits, verify model access, check authentication, and keep credentials and operator tokens offscreen. Use a fallback recorded run only if it is a genuine successful run, clearly identified as recorded.

## Exported HyperFrames edit

The local 3:30 silent 1080p30 MP4 is `videos/escapeproof-demo/renders/escapeproof-hackathon-demo.mp4`. It edits genuine completed-run evidence screenshots with on-screen narration and compressed waiting; it is not a continuous screen capture. Editable source, provenance and visual review are in `videos/escapeproof-demo/`. It has not been uploaded to YouTube.

## Updated narrated export

Final v2 file: `videos/escapeproof-demo/renders/escapeproof-hackathon-demo-v2-emma.mp4`. The new 3:30 edit includes the realistic full-screen website, new typography, how-to-play guide, and user-selected Emma narration. It uses genuine browser screenshots with camera moves and compressed waiting. Original Kane/Muse evidence is labeled as recorded before the visual refresh.

Chapters: 0:00 problem; 0:12 current room; 0:28 how to play; 0:58 where Kane CLI runs; 1:18 Muse authoring; 1:36 deliberate missing clue; 1:56 real Kane failure; 2:16 Muse repair; 2:36 both checks pass; 2:56 new manual playthrough; 3:20 verification claim and limits.

The Kane section displays the actual argument shape from `server/kane.ts`, with placeholders labeled. It explains how `server/worker.ts` calls the clue and intended-solution checks and returns failed results/evidence to Muse. This edit does not claim a new automated verification run after the UI refresh.
