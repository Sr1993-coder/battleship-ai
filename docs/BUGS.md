# Debugging Orbital Battleship

Every bug below is one I actually hit. Each entry says how it surfaced, what the
cause was, what I changed, and the test or repro that holds the fix in place.
Where a bug should have been caught earlier than it was, I say so.

## To debug, I used 5 approaches

1. **Exploratory play**: playing the game as a player, not as the author, with
   the seed written down so anything odd could be replayed. Catches turn-order,
   rendering and information-leak problems that no assertion was ever written
   for. Blind to rare edge cases, because a human plays the middle of the board.
2. **Unit tests for invariants**: writing down the properties the engine must
   never break, then testing them - including with `fast-check` over randomly
   generated fleets and thousands of complete games (`src/test/fuzz.test.ts`).
   The invariants:
   - ships never overlap and never touch, including diagonally
   - a fleet on the board always covers exactly 17 cells
   - a cell can be fired at only once; a repeat shot changes no state
   - the AI never fires at a cell it has already fired at
   - every game ends within 100 shots
   - a ship is sunk exactly when all of its cells are hit
   Catches off-by-one and boundary errors. Blind to anything involving the
   browser or the network.
3. **Independent review by a second Devin session**: a fresh session was given
   the repository and asked to find real defects with a proof for each, with no
   access to this document or to my own list. It catches bugs of omission, where
   my tests and my mental model share the same blind spot. It also produces
   false positives, so every finding was reproduced before being accepted.
4. **Degraded-environment and integration testing**: production build, throttled
   and offline network, aborted requests, page refreshes mid-game, and calling
   the NASA/JPL endpoint repeatedly instead of once. Catches integration bugs
   that pure game-logic tests cannot see, because they only exist once real HTTP
   and real React lifecycles are involved.
5. **Differential testing against a reference model**: a deliberately slow,
   obviously-correct model of the AI's probability map, compared against the fast
   implementation the game ships (`src/test/oracle.test.ts`). Catches subtly
   wrong optimisations - an algorithm that looks right, passes its examples, and
   is still wrong.

## Findings

### Category 1: Exploratory play - 3 bugs

**a. The AI treated J6 and A7 as neighbours.**
The Officer AI scored a hit at the right edge and then started firing on the far
left of the row below, as if the ship wrapped around the board. The board is a
flat array of 100 cells and the follow-up targeting worked in flat indices, so
"the cell to the right" was `index + 1`; index 59 is J6 and index 60 is A7, so
adjacency silently wrapped at every row boundary. *Resolution:* all adjacency now
goes through row/column helpers that return nothing off-grid, and the walk along
a line of hits steps by row/column deltas rather than by ±1 on the index.
Regression test in `ai.test.ts` ("does not treat hits on opposite edges as a
line"). Commit `8111cd6`.

**b. The placement preview spilled onto the next row.**
Hovering the Carrier near the right edge highlighted a few cells at the end of
one row and the rest at the start of the row below. The move itself was correctly
rejected, so this was cosmetic - but it drew a legal-looking highlight for an
illegal move. The preview reused `placementCells()`, which assumes the placement
is already legal. *Resolution:* a separate `previewCells()` that walks
row/column and drops cells that fall off the grid, so the highlight is always
clipped to the board. Tested in `board.test.ts`. Commit `756c5f5`.

**c. The enemy fleet panel leaked which ship you had hit.**
A hit lit up a damage pip next to the ship's name in the "Enemy fleet" list, so
two hits on the Cruiser told you exactly what you were shooting at and how many
cells were left - information the game is supposed to make you work for. I only
noticed because I had stopped guessing while playing. *Resolution:* a
`hideDamage` prop on `FleetStatus`; the enemy panel reveals a ship only once it
is sunk, or at game over when the whole board is shown anyway. Your own fleet
still shows damage. Commit `41a8cb6`. No automated test: this is a presentation
rule, and an assertion on rendered pips is more brittle than it is worth.

### Category 2: Unit tests for invariants - 1 bug

**a. Ships could hang off the bottom and right edges.**
A fleet occasionally came back with a ship that had fewer cells on the board than
its length, so it could never be fully sunk - an unwinnable game. The fuzz test
found it on the first run and shrank it to
`{"shipId":"carrier","row":10,"col":0,"orientation":"H"}` - row 10 on a 10x10
board, which I would never have clicked by hand. `inBounds()` checked that the
*end* of the ship fitted (`col + size <= BOARD_SIZE`) but never checked the
start, so for a horizontal ship `row` was not validated at all and the cells were
computed as indices past the end of the board. *Resolution:* validate the origin
as well as the far end. Regression test in `board.test.ts`, plus the fuzz property
that every placed ship has exactly `size` in-bounds cells. Commit `07fcdff`.

### Category 3: Independent review - 5 bugs

A second Devin session was given the repository, told to find real defects and to
prove each one with a throwaway script, and told not to change any code. It
reported no high-severity finding - it could not produce a wrong win or loss
through the rules engine, and `randomBoard` came back clean over 20,000 seeds -
four medium and four low. It also independently found the density-map bug in
category 5 below, from a different starting point, which is the most useful
signal in the whole exercise: two channels that share none of my assumptions
landed on the same defect.

**a. The Admiral could walk away from a wounded ship.**
A placement that explains an unresolved hit scored `30` per placement; open water
scored `1` per placement, and with the whole fleet afloat a central cell
accumulates up to `2 * (5+4+3+3+2) = 34`. So the "weighted heavily" bonus was
smaller than plain water:

```
unresolved hit: A1, all five ships still afloat
density[B1] (the only cell that can finish the wounded ship) = 30
density[E5] (empty water, nothing to do with the hit)        = 34
cells the Admiral actually picks over 20 rolls: E6,E5,F6,F5
```

*Resolution:* the bonus is now `1000 ** covered`, which is clear of the maximum
base count by a wide margin. Regression test in `ai.test.ts` ("finishes a wounded
ship rather than firing at open water"). Worth noting how rare this is in random
play - the reviewer measured 0 violations in 400 games and had to build the board
by hand, which is exactly why neither my tests nor my play found it.

**b. The Officer kept firing around a wreck.**
`chooseShot` preferred the queued follow-up cells in `state.targets` over the
follow-ups recomputed from current knowledge, and the queue was only filtered for
"already fired at". Cells queued while a ship was wounded therefore survived the
ship sinking, and the AI spent them next to the wreck - guaranteed misses under
the no-touching rule - while another ship sat wounded:

```
D9 hit - the cruiser is now wounded. Leftover queue is D5,F5
turn 3: fires D5 -> miss | proper follow-ups were: D8,D10,C9,E9
turn 4: fires F5 -> miss | proper follow-ups were: D8,D10,C9,E9
```

Over 400 games: 251 shots taken from the stale queue while a wounded ship was
pending. *Resolution:* the queue now only carries the order to work through, and
is intersected each turn with the follow-ups recomputed from current knowledge,
so stale cells drop out. The Officer's mean shots to clear a board went from
**57.8 to 53.9**. Regression test in `ai.test.ts`.

**c. A malformed `ephemeris.json` stalled the game forever.**
The client validated only `data.planets && data.planets.length !== 0`. A file
whose `planets` field is not an array passed that check (`{}.length` is
`undefined`), then `seedFromEphemeris` threw inside the mount effect's `.then`,
where a catch-all written for aborted fetches swallowed it. The enemy fleet was
never laid out and the UI sat on "Reading planetary positions..." with no error,
permanently, reload included. The same weak check also accepted a two-planet
file, which silently produces a different seed - the exact failure mode
category 4a says is worse than the fallback. *Resolution:* the response is now
validated properly - `planets` must be an array containing all three expected
bodies with finite coordinates - and anything else takes the offline fallback
that already existed for a 404. Tested in `ephemeris.test.ts`.

**d. Two clicks in one task fired twice in one turn.**
`playerFire` read `turn` from the render closure, so two clicks handled in the
same React batch both saw `turn === 'player'`, both fired, and the second board
update overwrote the first - two shots in the log, one mark on the grid. Real
mouse clicks are unaffected, because React flushes discrete events separately, so
this needed synthetic input and is low severity.

**e. The difficulty dropdown could postpone the AI's shot indefinitely.**
The AI's shot was scheduled by an effect with `aiState` in its dependency list,
and changing difficulty replaces `aiState`; toggling the dropdown faster than the
550 ms delay cleared and rescheduled the timer every time, so the enemy never
fired and the player could not act either, because it was not their turn.

*Resolution for both:* the turn is mirrored in a ref and checked there, so the guard does
not depend on render timing; the AI's memory moved to a ref as well, so
reconfiguring it no longer tears down the pending shot.

### Category 4: Degraded-environment and integration testing - 3 bugs

**a. "Everyone gets the same board today" was quietly false in production.**
The planetary-seed idea rests on every player on a given day getting the same
fleet layout. Locally it always did; against the deployed endpoint it sometimes
did not. Calling `/api/ephemeris` three times in a row, one response came back
with two planets instead of three, and two planets hash to a different seed. The
route fetched Venus, Mars and Jupiter with `Promise.all()`; Horizons throttles
requests that arrive together and answered one with an error, which the code read
as "no vector for this body" and skipped, returning a partial ephemeris that
still looked authoritative. *Resolution:* fetch the bodies sequentially, retry
each once, treat a missing body as a hard failure rather than shipping partial
data, and cache the result for an hour. `ephemeris.test.ts` asserts that dropping
a planet changes the seed, and pins a real Horizons report so the parser is
tested against what the service actually sends. Commit `b51bb41`.

**b. You could fire into an empty ocean, and your shots were then erased.**
On a slow connection the game let me place a fleet and start firing immediately.
Every shot missed, and when the planet data arrived all the markers disappeared
and the game silently restarted. Scripted with Playwright and a 20-second delay
on the ephemeris response: 14 shots, 0 hits, 14 markers before the seed landed
and 0 after. The enemy board started as `emptyBoard()` and was only filled in
inside `fetchEphemeris().then(...)`; `fleetDestroyed()` correctly returns false
for a board with no ships, so firing at nothing produced misses forever, and the
callback then overwrote the in-progress board along with every shot on it.
*Resolution:* "the seed has not landed yet" is now an explicit state -
`fleetReady(board)` gates placement, **Random fleet** and firing, the status line
says so, and the ephemeris callback uses a functional update that refuses to
overwrite a board already in play. Tested in `board.test.ts`, and the Playwright
repro was re-run afterwards.

**c. An aborted fetch was reported as "Horizons is down".**
In development the footer almost always said `fallback` even though the planet
data was fine, and this masked bug (b) for a while because the enemy fleet
appeared instantly. React StrictMode mounts effects twice in development; the
first mount's cleanup aborts its `fetch`, and `fetchEphemeris()` caught
everything and returned the offline fallback. A cancelled request is not a
service failure. *Resolution:* re-throw `AbortError` and ignore it at the call
site, since an abort only happens when the component is going away. Tested in
`ephemeris.test.ts`, alongside a test that a real 404 still does fall back.

### Category 5: Differential testing - 1 bug

**a. The Admiral AI wasted shots on cells that were provably empty.**
The reference model samples complete fleets consistent with the shots fired so
far, using the same legality rules the game uses to lay a fleet out, and counts
how often each cell holds a ship. Whatever it reports as impossible really is
impossible. Comparing it against `densityMap()` in a position where the Destroyer
had sunk on A1-B1 and two shots had missed:

```
samples: 20000
cells the oracle says are impossible but densityMap still targets: 4
C1: oracle 0.0000  densityMap 8
A2: oracle 0.0000  densityMap 8
B2: oracle 0.0000  densityMap 12
C2: oracle 0.0000  densityMap 20
```

Ships may not touch, so nothing can sit next to a ship that has sunk - those
cells are known-empty even though nothing has been fired at them. `densityMap()`
excluded misses and sunk cells but not the cells *around* a sunk ship, so it kept
enumerating placements through them and the Admiral kept firing there. The bug is
not visible as an illegal state, so no invariant caught it, and it is invisible in
play because a wasted shot looks like an ordinary miss. The independent review
found the same defect from a different direction, by measuring that 11% of the
Admiral's self-play shots landed on cells touching a sunk ship. *Resolution:* the
cells touching a sunk ship are now treated as blocked when enumerating
placements. Measured effect over 2000 headless games per level: the Admiral's
mean shots to clear a board went from **44.9 to 38.4** (`npm run benchmark`).
Regression tests:
`oracle.test.ts` asserts `densityMap()` never scores a cell the reference model
says is impossible, and `ai.test.ts` covers the specific adjacency case.

## End note: issues and vulnerabilities not fixed

- **The enemy fleet is readable in the browser.** The game is a static site with
  no server, so the AI's layout lives in client state and devtools will show it.
  Only a server-authoritative version, where the client sends a shot and receives
  hit or miss, would prevent this.
- **Boards are replayable from the seed.** Reproducibility is the point of the
  planetary seed, but it also means the layout for a given day can be learned
  once and replayed. A per-game seed derived from the shared daily seed would fix
  it without losing the property, and I would want that before running anything
  competitive.
- **No component-level tests.** Four of the bugs above lived in the React layer,
  which is still tested by hand and by Playwright scripts that are not checked
  in. Tests around the "seed not ready" state and the turn handover are the
  highest-value ones missing.
- **The Officer still fires at cells the rules make impossible.** It hunts on a
  parity grid with no notion of the no-touching rule, so it wastes shots next to
  sunk ships. That is arguably the right behaviour for a mid-difficulty,
  human-like opponent, so it is left as it is; the Admiral is the level that is
  supposed to reason from the rules.
- **`parseVector` only accepts exponent-notation numbers** (`X =-4.83E+08`). A
  Horizons report printing plain decimals would parse as a missing body and fail
  the daily build job. I could not show that Horizons ever formats vectors that
  way, so this is unproven and left alone rather than guessed at.
- **The reference model is sampled, not exhaustive.** 20,000 sampled fleets prove
  a cell is *possible*, and give strong but not absolute evidence that one is
  impossible. Exhaustive enumeration would be sound; it is too slow to run in the
  test suite as written.
- **The Admiral's density map is still an approximation.** It counts placements
  per remaining ship independently rather than counting complete fleets, so its
  probabilities are not exact. It is now consistent with the reference model on
  what is impossible, which is the part that changed its play.
- **Vercel blocked deployments mid-project** (Hobby plan), so the serverless
  ephemeris route was dropped; the site builds on GitHub Actions and the planet
  coordinates are fetched at build time into `public/ephemeris.json`, refreshed
  daily. Not a code bug, but it is why the architecture looks the way it does.
