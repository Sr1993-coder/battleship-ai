import { BOARD_SIZE, Board, ShipId, toCol, toIndex, toRow } from '../game/types';
import { occupiedCells, sunkShips, shipCellsOf } from '../game/board';

const COLUMNS = 'ABCDEFGHIJ'.split('');

export function cellName(index: number): string {
  return `${COLUMNS[toCol(index)]}${toRow(index) + 1}`;
}

interface Props {
  board: Board;
  /** Own board shows ships; enemy board hides everything not hit. */
  revealShips: boolean;
  onCellClick?: (index: number) => void;
  disabled?: boolean;
  preview?: number[];
  previewValid?: boolean;
  onCellEnter?: (index: number) => void;
  /** Per-cell weights, drawn as a shaded overlay. Any scale; it gets normalised. */
  heat?: number[];
  /** Cell the last shot landed on, so a turn is visible at a glance. */
  lastShot?: number | null;
}

export default function BoardView({
  board,
  revealShips,
  onCellClick,
  disabled,
  preview = [],
  previewValid = true,
  onCellEnter,
  heat,
  lastShot = null,
}: Props) {
  // Stretched between the lowest and highest live cell, otherwise every square
  // ends up the same shade of green.
  const live = heat ? heat.filter((v, i) => v > 0 && board.shots[i] === undefined) : [];
  const heatMin = live.length > 0 ? Math.min(...live) : 0;
  const heatSpan = live.length > 0 ? Math.max(...live) - heatMin : 0;
  const occupied = occupiedCells(board);
  const sunk = new Set<ShipId>(sunkShips(board));
  const sunkCells = new Set<number>();
  for (const id of sunk) for (const cell of shipCellsOf(board, id)) sunkCells.add(cell);
  const previewSet = new Set(preview);

  const rows = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    const cells = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      const index = toIndex(row, col);
      const shot = board.shots[index];
      const classes = ['cell'];
      if (revealShips && occupied.has(index)) classes.push('ship');
      if (shot === 'miss') classes.push('miss');
      if (shot === 'hit') classes.push(sunkCells.has(index) ? 'sunk' : 'hit');
      if (previewSet.has(index)) classes.push(previewValid ? 'preview' : 'preview-bad');
      if (index === lastShot) classes.push('last-shot');
      const weight =
        heat && heatSpan > 0 && shot === undefined
          ? Math.max(0, (heat[index] - heatMin) / heatSpan)
          : 0;
      cells.push(
        <button
          key={index}
          type="button"
          className={classes.join(' ')}
          style={
            weight > 0
              ? // Painted inside the border, so your own hulls still read as
                // outlines while the map is up.
                { boxShadow: `inset 0 0 0 30px rgba(74, 211, 161, ${0.12 + weight * 0.7})` }
              : undefined
          }
          aria-label={cellName(index)}
          data-cell={cellName(index)}
          disabled={disabled || (!!shot && !onCellEnter)}
          onMouseEnter={onCellEnter ? () => onCellEnter(index) : undefined}
          onClick={onCellClick ? () => onCellClick(index) : undefined}
        >
          {shot === 'miss' ? '\u00b7' : ''}
          {shot === 'hit' ? '\u2715' : ''}
        </button>,
      );
    }
    rows.push(
      <div className="board-row" key={row}>
        <span className="row-label">{row + 1}</span>
        {cells}
      </div>,
    );
  }

  return (
    <div className="board">
      <div className="board-row header">
        <span className="row-label" />
        {COLUMNS.map((c) => (
          <span className="col-label" key={c}>
            {c}
          </span>
        ))}
      </div>
      {rows}
    </div>
  );
}
