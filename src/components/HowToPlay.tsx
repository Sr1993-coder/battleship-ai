export default function HowToPlay({ epoch, source }: { epoch?: string; source?: string }) {
  return (
    <aside className="howto">
      <h3>How to play</h3>
      <ol>
        <li>
          Pick a difficulty. <b>Cadet</b> fires blindly, <b>Officer</b> hunts down a ship once it
          finds one, <b>Admiral</b> works out the most likely cell every single turn.
        </li>
        <li>
          Place your five ships on <b>your waters</b> (left). Hover a square to see where the ship
          goes, press <kbd>R</kbd> to rotate, click to drop it. Ships cannot touch each other, not
          even at the corners. <b>Random fleet</b> does it all for you.
        </li>
        <li>
          Click a square on <b>enemy waters</b> (right) to fire. A dot is a miss, a cross is a hit.
          Then the AI fires back at your grid.
        </li>
        <li>
          A ship sinks when every one of its squares is hit, and it turns dark red. Sink all five
          enemy ships before the AI sinks yours.
        </li>
      </ol>
      <h3>Why planets?</h3>
      <p>
        The enemy fleet has to be laid out at random, and random needs a starting number. Instead of
        using the clock, this game asks{' '}
        <a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noreferrer">
          NASA/JPL Horizons
        </a>{' '}
        where Venus, Mars and Jupiter actually are today, and turns those coordinates into the seed.
      </p>
      <p>
        So everyone playing on <b>{epoch ?? 'today'}</b> starts from the same real position of the
        solar system, and a game can be replayed exactly by its date. The angles in the footer are
        the live longitudes of those planets around the Sun.
        {source === 'fallback'
          ? ' Horizons is unreachable right now, so the game is running on its built-in backup coordinates.'
          : ''}
      </p>
    </aside>
  );
}
