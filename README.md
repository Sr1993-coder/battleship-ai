# Orbital Battleship

Battleship against an AI, in the browser. Classic rules on a 10x10 grid with the
standard five-ship fleet. The twist: the board seed comes from where the planets
actually are, pulled live from NASA/JPL Horizons, so every day's games start from
a real ephemeris (and the game still works when that service is unreachable).

Play: pick a difficulty, place your fleet (press `R` to rotate, or hit
**Random fleet**), then trade shots with the AI until one fleet is gone.

## AI levels

| Level   | Strategy |
| ------- | -------- |
| Cadet   | Fires at random untouched cells. |
| Officer | Random parity search, then hunts along the line of an unresolved hit. |
| Admiral | Counts every legal placement of the ships still afloat and fires at the highest-probability cell. |

The Admiral finishes a board in roughly 40 shots against the ~95 a random
shooter needs, which the test suite asserts so a regression in the targeting
code shows up as a failing test rather than a suspiciously easy game.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests + property-based game fuzzing
npm run ephemeris  # refresh public/ephemeris.json from JPL Horizons
npm run build
```

The browser cannot call Horizons directly (it sends no CORS headers) and the
site is static, so `npm run ephemeris` does the fetch and parse and writes
`public/ephemeris.json`. The deploy workflow runs it on every push and once a
day on a schedule. If that file is missing or stale the client falls back to a
fixed vector table and labels the seed `fallback` in the footer.

Hosted on GitHub Pages via `.github/workflows/deploy.yml`.

## Layout

```
src/game/     pure game logic - board, firing, AI, RNG, ephemeris parsing
src/components/  presentation only
src/test/     unit tests plus a fast-check fuzz harness that plays full games
scripts/      build-time fetch of the planetary ephemeris
docs/BUGS.md  the bugs found while building this, and how they were fixed
```

The game rules live in plain functions with no React in sight, which is what
makes the fuzz harness possible: it plays hundreds of complete games per run and
asserts the engine never reaches an illegal state.
