import { Board, FLEET } from '../game/types';
import { isSunk, shipCellsOf } from '../game/board';

export default function FleetStatus({ board, title }: { board: Board; title: string }) {
  return (
    <div className="fleet">
      <h3>{title}</h3>
      <ul>
        {FLEET.map((ship) => {
          const cells = shipCellsOf(board, ship.id);
          const hits = cells.filter((c) => board.shots[c] === 'hit').length;
          const down = isSunk(board, ship.id);
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
