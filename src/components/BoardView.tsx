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
}

export default function BoardView({
  board,
  revealShips,
  onCellClick,
  disabled,
  preview = [],
  previewValid = true,
  onCellEnter,
}: Props) {
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
      cells.push(
        <button
          key={index}
          type="button"
          className={classes.join(' ')}
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
