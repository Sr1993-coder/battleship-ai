# Debugging Orbital Battleship

## 5 approaches used for bug identification

1. **Exploratory play** — playing the game as a player with the seed written down
   so anything odd could be replayed. Catches turn-order, rendering, and
   information-leak problems. Misses rare edge cases because a human tends to
   play the middle of the board.
2. **Unit tests for invariants** — properties the engine must never break, tested
   with `fast-check` over randomly generated fleets and thousands of complete
   games (`src/test/fuzz.test.ts`):
   - ships never overlap or touch, including diagonally
   - a fleet always covers exactly 17 cells
   - a cell can only be fired at once; a repeat shot changes nothing
   - the AI never fires at a cell it has already fired at
   - every game ends within 100 shots
   - a ship is sunk exactly when all its cells are hit

   Catches off-by-one and boundary errors. Blind to anything involving the
   browser or network.
3. **Independent review by a second Devin session** — a fresh session given the
   repository, asked to find real defects with a proof for each, with no access
   to my own list. Catches bugs of omission where my tests and mental model
   share the same blind spot. Every finding was reproduced before being accepted.
4. **Degraded-environment and integration testing** — production build, throttled
   and offline network, aborted requests, page refreshes mid-game, and calling
   the NASA/JPL endpoint repeatedly rather than once. Catches integration bugs
   invisible to pure game-logic tests.
5. **Differential testing against a reference model** — a deliberately slow,
   obviously-correct model of the AI's probability map compared against the fast
   implementation (`src/test/oracle.test.ts`). Catches subtly wrong optimisations
   that look right, pass their examples, and are still wrong.

## Findings

### Category 1: Exploratory play — 3 bugs

**a. The AI treated J6 and A7 as neighbours.**
The board is a flat array of 100 cells and follow-up targeting worked on flat
indices, so "the cell to the right" was `index + 1`. Index 59 is J6 and index 60
is A7 — adjacency silently wrapped at every row boundary. The Officer AI scored a
hit at the right edge and started firing on the far left of the row below.

*Fix:* all adjacency now goes through row/column helpers that return nothing
off-grid, and walking a line of hits uses row/column deltas rather than ±1 on the
index. Regression test in `ai.test.ts`. Commit `8111cd6`.

**b. The placement preview spilled onto the next row.**
Hovering the Carrier near the right edge highlighted cells at the end of one row
and the start of the row below. The move was correctly rejected, but it drew a
legal-looking highlight for an illegal placement. The preview reused
`placementCells()`, which assumes the placement is already valid.

*Fix:* a separate `previewCells()` that walks row/column and drops cells that fall
off the grid. Tested in `board.test.ts`. Commit `756c5f5`.

**c. The enemy fleet panel revealed which ship had been hit.**
A hit lit up a damage pip next to the ship's name in the enemy fleet list — two
hits on the Cruiser told you exactly what you were shooting at and how many cells
remained.

*Fix:* a `hideDamage` prop on `FleetStatus`; the enemy panel only reveals a ship
once it is sunk, or at game over. Your own fleet still shows damage. Commit
`41a8cb6`. No automated test — asserting on rendered pips would be more brittle
than useful.

### Category 2: Unit tests for invariants — 1 bug

**a. Ships could hang off the bottom and right edges.**
A fleet occasionally came back with a ship that had fewer cells on the board than
its length — an unwinnable game. The fuzz test found it on the first run and
shrank it to `{"shipId":"carrier","row":10,"col":0,"orientation":"H"}` — row 10 on
a 10×10 board. `inBounds()` checked that the far end of the ship fit but not the
start, so for a horizontal ship, `row` wasn't validated at all.

*Fix:* validate the origin as well as the far end. Regression test in
`board.test.ts`. Commit `07fcdff`.

### Category 3: Independent review — 5 bugs

The second Devin session found no high-severity issues — no wrong win or loss
through the rules engine, and `randomBoard` came back clean over 20,000 seeds. It
independently found the density-map bug in category 5 from a different starting
point: two independent channels with no shared assumptions landing on the same
defect was the most useful signal in the exercise.

**a. The Admiral could walk away from a wounded ship.**
A placement explaining an unresolved hit scored 30 per placement; open water
scored 1 per placement, and with the whole fleet afloat a central cell accumulates
up to 2 × (5+4+3+3+2) = 34. The bonus was smaller than plain water:

```
unresolved hit: A1, all five ships still afloat
density[B1] (only cell that finishes the wounded ship) = 30
density[E5] (empty water, unrelated to the hit)        = 34
cells the Admiral picks over 20 rolls: E6, E5, F6, F5
```

*Fix:* the bonus is now `1000 ** covered`, well clear of the maximum base count.
Regression test in `ai.test.ts`. The reviewer measured 0 violations in 400 games
and had to construct the board by hand — which is why neither my tests nor my play
found it.

**b. The Officer kept firing around a wreck.**
`chooseShot` preferred queued follow-up cells in `state.targets` over follow-ups
recomputed from current knowledge, and the queue was only filtered for "already
fired at." Cells queued while a ship was wounded survived the ship sinking, and
the AI spent them next to the wreck — guaranteed misses under the no-touching
rule — while another ship sat wounded:

```
D9 hit — Cruiser wounded. Leftover queue: D5, F5
turn 3: fires D5 -> miss | correct follow-ups: D8, D10, C9, E9
turn 4: fires F5 -> miss | correct follow-ups: D8, D10, C9, E9
```

Over 400 games: 251 shots from the stale queue while a wounded ship was pending.

*Fix:* the queue now only carries order, intersected each turn with follow-ups
recomputed from current knowledge. Officer's mean shots to clear a board went from
57.8 to 53.9. Regression test in `ai.test.ts`.

**c. A malformed `ephemeris.json` stalled the game permanently.**
The client validated only `data.planets && data.planets.length !== 0`. A file
whose `planets` field isn't an array passed that check, then `seedFromEphemeris`
threw inside the mount effect's `.then`, where a catch-all written for aborted
fetches swallowed it. The UI sat on "Reading planetary positions..." permanently —
reload included.

*Fix:* `planets` must now be an array containing all three expected bodies with
finite coordinates; anything else takes the offline fallback. Tested in
`ephemeris.test.ts`.

**d. Two clicks in one task fired twice in one turn.**
`playerFire` read `turn` from the render closure, so two clicks in the same React
batch both saw `turn === 'player'`, both fired, and the second board update
overwrote the first — two shots in the log, one mark on the grid. Low severity;
only reproducible with synthetic input.

**e. The difficulty dropdown could delay the AI's shot indefinitely.**
The AI's shot was scheduled by an effect with `aiState` in its dependency list.
Changing difficulty replaces `aiState`; toggling the dropdown faster than the
550 ms delay cleared and rescheduled the timer each time — the AI never fired and
the player couldn't act either.

*Fix for both (d) and (e):* `turn` mirrored in a ref and checked there; AI memory
moved to a ref so reconfiguring it no longer cancels the pending shot.

### Category 4: Degraded-environment and integration testing — 3 bugs

**a. "Everyone gets the same board today" was quietly false in production.**
Calling `/api/ephemeris` three times in a row, one response came back with two
planets instead of three. The route fetched Venus, Mars, and Jupiter with
`Promise.all()`; Horizons throttled requests arriving together and answered one
with an error, which the code read as "no vector for this body" and skipped —
returning partial data that still looked authoritative.

*Fix:* fetch bodies sequentially, retry each once, treat a missing body as a hard
failure, cache for an hour. Commit `b51bb41`.

**b. You could fire into an empty ocean and the shots would be erased.**
On a slow connection the game allowed placement and firing before planet data
arrived. Every shot missed; when the seed landed all markers disappeared and the
game silently restarted. Scripted with Playwright at a 20-second delay: 14 shots,
0 hits, 14 markers before the seed — 0 after. The enemy board started as
`emptyBoard()` and was only filled inside `fetchEphemeris().then(...)`; the
callback then overwrote the in-progress board.

*Fix:* "seed not ready" is now an explicit state — `fleetReady(board)` gates
placement, random fleet, and firing; the ephemeris callback uses a functional
update that won't overwrite a board already in play. Tested in `board.test.ts`.

**c. An aborted fetch was reported as "Horizons is down."**
React StrictMode mounts effects twice in development; the first mount's cleanup
aborted its `fetch`, and `fetchEphemeris()` caught everything and returned the
offline fallback — masking bug (b) because the enemy fleet appeared instantly.

*Fix:* re-throw `AbortError` and ignore it at the call site. Tested in
`ephemeris.test.ts`.

### Category 5: Differential testing — 1 bug

**a. The Admiral wasted shots on cells that were provably empty.**
Comparing the reference model against `densityMap()` with the Destroyer sunk on
A1–B1 and two missed shots:

```
samples: 20,000
cells the oracle says are impossible but densityMap still targets: 4
C1: oracle 0.0000  densityMap 8
A2: oracle 0.0000  densityMap 8
B2: oracle 0.0000  densityMap 12
C2: oracle 0.0000  densityMap 20
```

Ships can't touch, so cells adjacent to a sunk ship are known-empty even if
nothing has been fired there. `densityMap()` excluded misses and sunk cells but
not the surrounding cells, so it kept enumerating placements through them. The
independent review found the same defect from a different angle — 11% of the
Admiral's self-play shots landed on cells touching a sunk ship.

*Fix:* cells touching a sunk ship are now blocked when enumerating placements.
Admiral's mean shots to clear a board went from 44.9 to 38.4 over 2,000 headless
games (`npm run benchmark`). Regression tests in `oracle.test.ts` and
`ai.test.ts`.

## Issues not fixed

- **Enemy fleet readable in the browser.** The AI's layout lives in client state;
  devtools will show it. Only a server-authoritative version would prevent this.
- **Boards replayable from the seed.** The layout for a given day can be learned
  once and replayed. A per-game seed derived from the shared daily seed would fix
  this without losing the shared-board property.
- **No component-level tests.** Four bugs above lived in the React layer, tested
  only by hand and unchecked Playwright scripts. Tests around the "seed not ready"
  state and turn handover are the highest-value ones missing.
- **The Officer still fires at cells the rules make impossible.** It hunts on a
  parity grid with no notion of the no-touching rule. Left as-is — arguably
  appropriate for a mid-difficulty opponent.
- **`parseVector` only accepts exponent-notation numbers.** A Horizons report
  printing plain decimals would parse as a missing body. Unconfirmed whether
  Horizons ever formats that way, so left alone.
- **The reference model is sampled, not exhaustive.** 20,000 samples give strong
  but not absolute evidence. Exhaustive enumeration would be sound; too slow for
  the test suite as written.
- **The Admiral's density map is still an approximation.** It counts placements
  per ship independently rather than complete fleets. Now consistent with the
  reference model on what's impossible — which is what changed its behaviour.
- **Vercel blocked deployments mid-project** (Hobby plan). The site builds on
  GitHub Actions; planet coordinates are fetched at build time into
  `public/ephemeris.json`, refreshed daily.
