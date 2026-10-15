# Cases

Own cases, written by Claude on classic business domains (not copied from textbooks). Same domains as StrataSQL's cases where possible, so a student sees the data model and the process of one business.

## Planned ladder (one new idea per step)

| # | Case | ★ | New ideas |
|---|---|---|---|
| 1 | Library: lend a book | ★ | start/end, tasks, one XOR with named flows, two lanes |
| 2 | Hotel: booking and check-in | ★ | message events, second pool (guest) as black box, message flows |
| 3 | Online shop: order fulfilment | ★★ | AND split/join (pack ∥ invoice), timer (payment deadline), boundary event |
| 4 | Scooter sharing: a ride | ★★ | event-based gateway, intermediate events, loop |
| 5 | Hospital: patient admission | ★★ | sub-processes, data objects/stores, OR gateway (and why to avoid it) |
| 6 | Football: match day | ★★★ | several pools, exceptions (error end + error boundary; escalation left out, see the case), multi-instance |
| 7 | AS-IS → TO-BE (own, generic office process) | ★★★ | redesign, KPIs, simulation |

Written: 1 `library-lend`, 2 `hotel-booking`, 3 `shop-order`, 4 `scooter-ride`, 5 `hospital-admission`, 6 `football-match`. Case 7 waits for stage 6 (Simulate): its KPIs need durations and simulation. Each has `<id>.md` and the reference model `<id>.flow.json` (File → Open in the app), drawn by `tests/fixtures/cases.ts`; `UPDATE_CASES=1 npx vitest run tests/cases.test.ts` rewrites the `.flow.json` after a change there.

## Case file sections (`<id>.md`)

1. Meta: id, title, difficulty, concepts trained
2. Case text (verbatim, what the student reads)
3. Text → model mapping: phrase → element → why
4. Reference process (pools, lanes, nodes, flows), written as a list the generator can read
5. Key decisions and alternatives (✱ for Claude's choices)
6. AS-IS problems / TO-BE ideas (where relevant)
7. Hints per level, synonyms (task name variants)

Never add the owner's graded group project (or anything that identifies the owner's employer) here.
