import { Board, FLEET } from '../game/types';
import { isSunk, shipCellsOf } from '../game/board';

interface Props {
  board: Board;
  title: string;
  /**
   * Hides per-ship hit counts. The enemy panel must not tell the player which
   * ship a hit belonged to before that ship sinks.
   */
  hideDamage?: boolean;
}

export default function FleetStatus({ board, title, hideDamage = false }: Props) {
  return (
    <div className="fleet">
      <h3>{title}</h3>
      <ul>
        {FLEET.map((ship) => {
          const cells = shipCellsOf(board, ship.id);
          const down = isSunk(board, ship.id);
          const hits = hideDamage
            ? (down ? ship.size : 0)
            : cells.filter((c) => board.shots[c] === 'hit').length;
          return (
            <li key={ship.id} className={down ? 'down' : ''}>
              <span className="ship-name">{ship.name}</span>
              <span className="pips">
                {Array.from({ length: ship.size }, (_, i) => (
                  <i key={i} className={i < hits ? 'pip hit' : 'pip'} />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
