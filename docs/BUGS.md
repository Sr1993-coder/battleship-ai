# Bugs I found in Orbital Battleship, and how I fixed them

Notes I kept while building and debugging this. Every bug below is one I actually
hit; each has a commit and, where the bug lives in the game logic, a test that
fails before the fix. Two of them only show up in a production build, and one
only showed up against the deployed API, which is the part I found most
interesting.

How I hunted for them:

- unit tests for the rules I could state precisely (placement, firing, sinking)
- a `fast-check` fuzz harness (`src/test/fuzz.test.ts`) that generates random
  placements and plays hundreds of complete AI-vs-board games per run, asserting
  the engine never reaches an illegal state
- playing the game in the browser, including on a deliberately slow network
- hitting the deployed ephemeris endpoint repeatedly rather than once

---

## 1. Ships could hang off the bottom and right edges

**Symptom.** A fleet occasionally came back with a ship that had fewer cells on
the board than its length, so it could never be fully sunk - a game that can't
be won.

**How I found it.** The fuzz test, on the first run. `fast-check` shrank it to a
minimal counterexample and printed:

```
Counterexample: {"shipId":"carrier","row":10,"col":0,"orientation":"H"}
```

Row 10 on a 10x10 board. I would not have clicked there by hand.

**Root cause.** `inBounds()` checked that the *end* of the ship fitted
(`col + size <= BOARD_SIZE`) but never checked the *start*. For a horizontal
ship, `row` was not validated at all, so `row: 10` sailed through and the cells
were computed as indices past the end of the board.

**Fix.** Validate the origin as well as the far end (`src/game/board.ts`):

```ts
if (placement.row < 0 || placement.col < 0) return false;
if (placement.row >= BOARD_SIZE || placement.col >= BOARD_SIZE) return false;
```

**Test.** `board.test.ts` - "rejects a placement that starts off the board", plus
the fuzz property that every placed ship has exactly `size` in-bounds cells.

Commit `07fcdff`.

---

## 2. The AI thought J6 and A7 were neighbours

**Symptom.** The Officer AI would score a hit at the right edge of the board and
then start firing on the far left of the next row down, as if the ship wrapped
around. It looked like the AI was cheating in the dumbest possible way.

**How I found it.** Playing. The battle log made it obvious once I read the cell
names out loud: `J6` hit, then `A7`, `B7`...

**Root cause.** The board is stored as a flat array of 100 cells and the
follow-up targeting worked in flat indices: "neighbour to the right" was
`index + 1`. Index 59 is J6 and index 60 is A7, so at every row boundary the
neighbourhood silently wrapped.

**Fix.** All adjacency now goes through row/column helpers that return `null`
off-grid (`src/game/ai.ts`):

```ts
const cellAt = (row: number, col: number): number | null =>
  row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE ? null : toIndex(row, col);
```

and the "extend along the line of hits" walk uses `dr`/`dc` steps instead of
`+1`/`-1` on the index.

**Test.** `ai.test.ts` - "does not treat the end of a row as adjacent to the
start of the next one".

Commit `8111cd6`.

---

## 3. The placement preview spilled onto the next row

**Symptom.** Hovering the Carrier near the right edge highlighted a few cells at
the end of one row and the rest at the beginning of the row below. The placement
itself was correctly rejected, so this was cosmetic - but it made a legal-looking
highlight for an illegal move, which is worse than showing nothing.

**How I found it.** Same root cause as #2, so I went looking for other places
that did arithmetic on flat indices, and this one was in the UI.

**Root cause.** The preview reused `placementCells()`, which assumes the
placement is already legal.

**Fix.** A separate `previewCells()` that walks row/column and drops any cell
that falls off the grid, so the highlight is always clipped to the board.

**Test.** `board.test.ts` - preview clipping at the right and bottom edges.

Commit `756c5f5`.

---

## 4. The enemy fleet panel leaked which ship you had hit

**Symptom.** Hit a ship, and the "Enemy fleet" list lit up a damage pip next to
the ship's name. Two hits on the Cruiser and you knew exactly what you were
shooting at and how many cells were left. That is the information the game is
supposed to make you work for.

**How I found it.** Playing it as a player rather than as the author. I noticed I
had stopped guessing.

**Fix.** A `hideDamage` prop on `FleetStatus`; the enemy panel only reveals a
ship once it is sunk (or at game over, when the whole board is revealed
anyway). Your own fleet still shows damage, which is the point of it.

Commit `41a8cb6`.

No automated test for this one - it is a presentation rule and I judged an
assertion on rendered pips to be more brittle than it is worth.

---

## 5. The "same seed for everyone today" claim was quietly false in production

**Symptom.** The whole planetary-seed idea rests on everyone who plays on a given
day getting the same board. Locally it always did. Against the deployed endpoint,
sometimes it didn't.

**How I found it.** I hit `/api/ephemeris` on the deployment three times in a row
instead of once, and one response came back with two planets instead of three.
Two planets hash to a different seed, so that player got a different board.

**Root cause.** The route fetched Venus, Mars and Jupiter with `Promise.all()`.
NASA/JPL Horizons throttles requests that arrive together and answered one of
them with an error, which the code treated as "no vector for this body" and
skipped, happily returning a partial ephemeris.

**Fix.** Fetch the bodies one at a time, retry each once after a short delay, and
treat a missing body as a hard failure rather than shipping partial data - a
partial ephemeris is worse than the offline fallback, because it looks
authoritative. Also added an hour of cache so the upstream sees far fewer calls.

**Test.** `ephemeris.test.ts` asserts that dropping a planet changes the seed,
which is the property that made the partial response dangerous, plus parser tests
against a real Horizons report (its text format puts negative numbers hard
against the `=`, e.g. `X =-4.83E+08`, which my first regex missed).

Commit `b51bb41`.

---

## 6. You could fire into an empty ocean, and your shots were then erased

**Symptom.** On a slow connection, the game let me click **Random fleet** and
start firing immediately. Every shot was a miss, no matter where I fired. When
the planet data finally arrived, all the miss markers on the enemy grid
disappeared and the game silently restarted itself.

**How I found it.** Suspicion, then a repro. The enemy fleet is laid out from the
planetary seed, so it cannot exist before that fetch resolves - but nothing in
the UI said so. I scripted the page with Playwright, delayed the ephemeris
response by 20 seconds, fired 14 shots and counted:

```
player shots: 14 hits: 0
enemy grid marks before seed lands: 14
enemy grid marks after seed lands: 0
```

14 shots, zero hits (the real fleet is 17 of 100 cells, so that is not luck), and
then all 14 markers gone.

**Root cause.** Two things. The enemy board started as `emptyBoard()` and was
only filled in inside the `fetchEphemeris().then(...)`, and `fleetDestroyed()`
returns `false` for a board with no ships (correctly - otherwise an empty board
would count as an instant win), so firing at nothing just produced misses
forever. Then the `then` callback called `setAiBoard(randomBoard(...))`
unconditionally and threw away the in-progress board along with every shot on it.

**Fix.** Treat "seed has not landed" as an explicit state:

- `fleetReady(board)` in `src/game/board.ts` - a board is playable only when all
  five ships are on it
- placement, **Random fleet** and firing are all gated on it, and the status line
  says *"Reading planetary positions before the enemy fleet is laid out..."*
- the ephemeris callback now uses a functional update and refuses to overwrite a
  board that is already in play

**Test.** `board.test.ts` - `fleetReady` is false for an empty and a partial
board, true for a full one. Re-ran the Playwright repro afterwards: the button is
disabled, clicks on the enemy grid do nothing, and the battle log stays empty
until the seed lands.

---

## 7. An aborted fetch was reported as "Horizons is down"

**Symptom.** In development the footer almost always said `fallback` even though
the planet data was there and fine. It also hid bug #6 from me for a while,
because in development the enemy fleet appeared instantly.

**How I found it.** Chasing #6. My first repro of #6 failed to reproduce in
`npm run dev` - I got hits on a board that should not have existed yet. That
mismatch was the tell.

**Root cause.** React StrictMode mounts effects twice in development. The first
mount's cleanup aborts its `fetch`, and `fetchEphemeris()` caught *everything*
and returned the offline fallback. So the aborted request resolved instantly with
fallback coordinates, which set the enemy board early (masking #6) and mislabelled
the seed source. A cancelled request is not a service failure.

**Fix.** Re-throw `AbortError` instead of swallowing it, and ignore it at the
call site since an abort only happens when the component is going away.

**Test.** `ephemeris.test.ts` - "rejects an aborted request instead of reporting a
fallback seed", alongside a test that a 404 still does fall back.

---

## Not code bugs, but they cost me time

- **Vercel blocked new deployments** part-way through (Hobby plan) and asked for
  an upgrade, so the serverless ephemeris route had to go. The site now builds on
  GitHub Actions and the planet coordinates are fetched at build time into
  `public/ephemeris.json`, refreshed daily on a schedule. Same behaviour for the
  player, one less runtime dependency - the browser can't call Horizons directly
  anyway, since it sends no CORS headers.
- **Horizons' text report format.** The vectors come back as a text report inside
  JSON, and the numbers are not laid out the way the docs' examples suggest. I
  pinned a real report into `ephemeris.test.ts` so the parser is tested against
  what the service actually sends rather than what I assumed.

## What I would do next

The fuzz harness only plays AI-vs-board games; the React layer is tested by hand.
Bugs #6 and #7 both lived in that layer, which tells me where the next tests
should go - a couple of component-level tests around the "seed not ready yet"
state and the turn handover would have caught both.
