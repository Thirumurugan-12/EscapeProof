# Verification record

Verified on **17 November 2026**. All results below distinguish actual provider/browser runs from test fixtures.

## Local checks

- **20 tests pass**, covering game transitions and wrong answers, private projections, dependency validation, immutable revisions, exact-revision publication, isolated sessions, preview-ticket binding, queue/repair limits, operator access, process cancellation, server recovery, event streaming, and Meta API routing/validation.
- TypeScript checking and the production build pass.
- The production server runs at `http://127.0.0.1:3001`. HTML, built assets, health, and public play routes return HTTP 200; unauthenticated operator access returns HTTP 401.
- Desktop and 390px mobile layouts were inspected. Notebook keyboard activation, Escape-to-close, and progressive hints were exercised.
- Docker Compose **v5.7.1** validates `compose.yaml` with `config --quiet`. Docker Engine is unavailable, so the actual image build/container runtime has not been tested.

## Genuine provider and browser acceptance

Provider: **Meta Muse**, model `muse-spark-1.3`, through `https://api.meta.ai/v1`. Kane CLI **0.10.4** is installed in the local toolchain and authenticated with the user's TestMu account.

The completed live sequence was:

1. Muse generated room revision `43760f9f-b7dd-49dc-a1a0-e7812ae27108`.
2. The developer fault control created revision `4ae7fa2d-c11d-4e0a-ae8a-1f4810946b37` with its required notebook clue removed.
3. Kane job `1a2e545f-4ec5-4a9e-8de6-595cd300055b` inspected the notebook and **failed** the clue check. Its real result identified the blank final entry.
4. That failure evidence reached Muse. Muse created revision `aefe6da6-daf5-45ec-92ed-251914ae4fe3`, changing only the notebook section. The combination, prerequisites, item placement, and intended solution were preserved.
5. Kane's independent **clue availability** and **intended solution** checks both **passed** on that repaired revision, using separate player sessions/browser profiles.
6. The exact verified revision was published **inside the local application**.
7. A separate, fresh public Kane browser **passed** the escape flow without being supplied the answer, using the notebook clue and visible game controls only.
8. An additional browser walkthrough completed the published room through normal controls, ending at **You escaped**, with six moves and zero hints. Its screenshot is `docs/screenshots/verified-room-escape.jpg`.

Exactly **one repair** was needed in the accepted job. No success result, room repair, or evidence screenshot was fabricated.

## Evidence locations

- [Machine-readable manifest](live-evidence.json) records revision IDs, actual check outcomes, and SHA-256 hashes of the sealed evidence packs.
- The failed and repaired checks are under `data/evidence/1a2e545f-4ec5-4a9e-8de6-595cd300055b/`.
- The fresh public-player result and `acceptance.json` are under `data/public-player-evidence/1a2e545f-4ec5-4a9e-8de6-595cd300055b/`.
- Raw `.evidence` packs, NDJSON, and stderr are local/private and ignored by Git. Operator-authenticated workshop links expose these artifacts locally. Review private evidence before sharing it externally.
- Current UI screenshots are `docs/screenshots/workshop-verified.jpg` and `docs/screenshots/verified-room-escape.jpg`.

Kane's sealed evidence includes screenshots and logs; no automatic video artifact is claimed. Use the separate demo script to record the requested YouTube presentation.

## Setup failures retained honestly

Earlier authentication failures and interrupted jobs remain recorded. A real initial preview test also failed because Kane loaded the one-time link twice. Preview redemption now binds the ticket to the first signed player session and allows only that same session to revisit it; another session cannot reuse it. Regression tests cover this behavior. The successful job above ran after this correction.

## External actions

A public GitHub source repository was authorized by the user on 17 November 2026. The hackathon form has a saved draft. No external deployment, YouTube upload, public launch posts, or final hackathon submission is recorded. Docker setup, README, environment template, demo script, and submission checklist are provided.

Verification demonstrates the intended route and accessible clues. It does not certify fairness, universal solvability, or absence of every shortcut.
