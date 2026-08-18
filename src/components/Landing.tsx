import { useEffect, useState } from 'react';
import benchmark from '../game/benchmark.json';
import { Ephemeris, eclipticLongitude, fetchEphemeris, seedFromEphemeris } from '../game/ephemeris';
import { FLEET } from '../game/types';

const DIFFICULTY_COPY: Record<string, { name: string; blurb: string }> = {
  random: { name: 'Cadet', blurb: 'Fires at a random empty square. The control group.' },
  hunter: {
    name: 'Officer',
    blurb: 'Searches on a checkerboard, then chases a ship along its axis once it lands a hit.',
  },
  admiral: {
    name: 'Admiral',
    blurb:
      'Every turn, counts how many ways the ships still afloat could fit through each square and shoots the busiest one.',
  },
};

export default function Landing() {
  const [ephemeris, setEphemeris] = useState<Ephemeris | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchEphemeris(controller.signal)
      .then(setEphemeris)
      .catch(() => {
        // Aborted; nothing to show.
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="app landing">
      <header>
        <p className="eyebrow">Battleship vs an AI</p>
        <h1>Orbital Battleship</h1>
        <p className="sub">
          The usual ten by ten grid and five hidden ships. What is not usual: the enemy fleet is laid
          out from where Venus, Mars and Jupiter actually are today, so every player gets the same
          board on the same day, and any game can be replayed from its date.
        </p>
        <a className="cta" href="#/play">
          Play the game
        </a>
      </header>

      <section className="landing-block">
        <h2>The fleet</h2>
        <p>
          Both sides hide the same five ships. A ship is that many squares in a straight line, and
          ships may not touch, not even at a corner. Seventeen squares of ship in a hundred squares
          of ocean.
        </p>
        <ul className="fleet-scale">
          {FLEET.map((ship) => (
            <li key={ship.id}>
              <span className="ship-name">{ship.name}</span>
              <span className="hull">
                {Array.from({ length: ship.size }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
              <span className="dim">{ship.size}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-block">
        <h2>How a turn works</h2>
        <ol>
          <li>You place your five ships on your own grid, or let the seed place them for you.</li>
          <li>You click one square on the enemy grid. It is a hit or a miss, nothing else.</li>
          <li>The AI fires one square back at your grid.</li>
          <li>
            A ship sinks when every one of its squares is hit. First fleet to lose all five loses.
          </li>
        </ol>
      </section>

      <section className="landing-block">
        <h2>Three opponents, and how good they actually are</h2>
        <p>
          I did not want to guess whether the AI was any good, so the repo has a self-play benchmark:
          each opponent clears {benchmark.games.toLocaleString()} randomly generated boards on its
          own and I count the shots. A perfect game is 17 shots, the worst possible is 100.
        </p>
        <table className="bench">
          <thead>
            <tr>
              <th>Opponent</th>
              <th>How it thinks</th>
              <th>Mean shots</th>
              <th>Best</th>
            </tr>
          </thead>
          <tbody>
            {benchmark.results.map((row) => (
              <tr key={row.difficulty}>
                <td>{DIFFICULTY_COPY[row.difficulty].name}</td>
                <td className="dim">{DIFFICULTY_COPY[row.difficulty].blurb}</td>
                <td className="num">{row.mean}</td>
                <td className="num dim">{row.best}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dim small">
          Reproduce with <code>npm run benchmark</code>. Same seed, same numbers.
        </p>
      </section>

      <section className="landing-block">
        <h2>Today&apos;s seed</h2>
        <p>
          Random needs a starting number. Instead of the clock, a scheduled job asks{' '}
          <a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noreferrer">
            NASA/JPL Horizons
          </a>{' '}
          where three planets are, and those coordinates become the seed that lays out the fleets.
        </p>
        {ephemeris ? (
          <>
            <table className="bench">
              <thead>
                <tr>
                  <th>Planet</th>
                  <th>Heliocentric x, y (km)</th>
                  <th>Longitude</th>
                </tr>
              </thead>
              <tbody>
                {ephemeris.planets.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td className="dim num">
                      {p.x.toExponential(3)}, {p.y.toExponential(3)}
                    </td>
                    <td className="num">{eclipticLongitude(p).toFixed(1)}&deg;</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="seedline">
              Epoch <b>{ephemeris.epoch}</b> &rarr; seed{' '}
              <b>{seedFromEphemeris(ephemeris).toString(16)}</b>{' '}
              <span className="dim">
                ({ephemeris.source === 'fallback' ? 'built-in backup coordinates' : ephemeris.source}
                )
              </span>
            </p>
          </>
        ) : (
          <p className="dim">Reading planetary positions&hellip;</p>
        )}
      </section>

      <section className="landing-block">
        <h2>If you are here to read code</h2>
        <p>
          The game rules are pure functions with no React in them, which is what makes the fuzz tests
          and the benchmark possible. In the game you can switch on the{' '}
          <b>AI targeting map</b> to see the probability grid the Admiral is working from as it
          shoots at you.
        </p>
        <ul className="links">
          <li>
            <a href="https://github.com/Sr1993-coder/battleship-ai">Source on GitHub</a>
          </li>
          <li>
            <a href="https://github.com/Sr1993-coder/battleship-ai/blob/main/docs/BUGS.md">
              The bugs I found and how they were fixed
            </a>
          </li>
        </ul>
        <a className="cta" href="#/play">
          Play the game
        </a>
      </section>
    </div>
  );
}
