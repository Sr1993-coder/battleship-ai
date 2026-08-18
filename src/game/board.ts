import {
  BOARD_SIZE,
  Board,
  FLEET,
  FireOutcome,
  Placement,
  ShipId,
  shipById,
  toCol,
  toIndex,
  toRow,
} from './types';
import { Rng } from './rng';

export function emptyBoard(): Board {
  return { placements: [], shots: {} };
}

export function placementCells(placement: Placement): number[] {
  const { row, col, orientation } = placement;
  const size = shipById(placement.shipId).size;
  const cells: number[] = [];
  for (let i = 0; i < size; i++) {
    const r = orientation === 'V' ? row + i : row;
    const c = orientation === 'H' ? col + i : col;
    cells.push(toIndex(r, c));
  }
  return cells;
}

export function inBounds(placement: Placement): boolean {
  const size = shipById(placement.shipId).size;
  if (placement.row < 0 || placement.col < 0) return false;
  if (placement.row >= BOARD_SIZE || placement.col >= BOARD_SIZE) return false;
  if (placement.orientation === 'H') return placement.col + size <= BOARD_SIZE;
  return placement.row + size <= BOARD_SIZE;
}

export function occupiedCells(board: Board): Map<number, ShipId> {
  const map = new Map<number, ShipId>();
  for (const placement of board.placements) {
    for (const cell of placementCells(placement)) map.set(cell, placement.shipId);
  }
  return map;
}

function neighbours(index: number): number[] {
  const row = toRow(index);
  const col = toCol(index);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) continue;
      out.push(toIndex(r, c));
    }
  }
  return out;
}

export interface PlacementRules {
  /** When false, ships may not share an edge or corner with another ship. */
  allowTouching: boolean;
}

export const DEFAULT_RULES: PlacementRules = { allowTouching: false };

export function canPlace(
  board: Board,
  placement: Placement,
  rules: PlacementRules = DEFAULT_RULES,
): boolean {
  if (!inBounds(placement)) return false;
  if (board.placements.some((p) => p.shipId === placement.shipId)) return false;
  const occupied = occupiedCells(board);
  const cells = placementCells(placement);
  for (const cell of cells) {
    if (occupied.has(cell)) return false;
    if (!rules.allowTouching) {
      for (const n of neighbours(cell)) {
        if (occupied.has(n)) return false;
      }
    }
  }
  return true;
}

export function placeShip(
  board: Board,
  placement: Placement,
  rules: PlacementRules = DEFAULT_RULES,
): Board {
  if (!canPlace(board, placement, rules)) throw new Error('illegal placement');
  return { ...board, placements: [...board.placements, placement] };
}

export function randomBoard(rng: Rng, rules: PlacementRules = DEFAULT_RULES): Board {
  for (let attempt = 0; attempt < 200; attempt++) {
    let board = emptyBoard();
    let ok = true;
    for (const ship of FLEET) {
      const options: Placement[] = [];
      for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
          for (const orientation of ['H', 'V'] as const) {
            const candidate: Placement = { shipId: ship.id, row, col, orientation };
            if (canPlace(board, candidate, rules)) options.push(candidate);
          }
        }
      }
      if (options.length === 0) {
        ok = false;
        break;
      }
      board = placeShip(board, options[Math.floor(rng() * options.length)], rules);
    }
    if (ok) return board;
  }
  throw new Error('could not lay out fleet');
}

export function shipCellsOf(board: Board, shipId: ShipId): number[] {
  const placement = board.placements.find((p) => p.shipId === shipId);
  return placement ? placementCells(placement) : [];
}

export function isSunk(board: Board, shipId: ShipId): boolean {
  const cells = shipCellsOf(board, shipId);
  if (cells.length === 0) return false;
  return cells.every((cell) => board.shots[cell] === 'hit');
}

export function sunkShips(board: Board): ShipId[] {
  return board.placements.map((p) => p.shipId).filter((id) => isSunk(board, id));
}

export function fleetDestroyed(board: Board): boolean {
  return board.placements.length > 0 && board.placements.every((p) => isSunk(board, p.shipId));
}

export function fire(board: Board, index: number): FireOutcome {
  if (index < 0 || index >= BOARD_SIZE * BOARD_SIZE) throw new Error('shot off board');
  if (board.shots[index] !== undefined) return { board, result: 'repeat' };

  const occupied = occupiedCells(board);
  const shipId = occupied.get(index);
  const shots = { ...board.shots, [index]: shipId ? ('hit' as const) : ('miss' as const) };
  const next: Board = { ...board, shots };

  if (!shipId) return { board: next, result: 'miss' };
  if (isSunk(next, shipId)) {
    return { board: next, result: 'sunk', shipId, sunkCells: shipCellsOf(next, shipId) };
  }
  return { board: next, result: 'hit', shipId };
}

export function remainingShips(board: Board): ShipId[] {
  return board.placements.map((p) => p.shipId).filter((id) => !isSunk(board, id));
}
