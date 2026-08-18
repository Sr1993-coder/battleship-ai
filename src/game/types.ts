export const BOARD_SIZE = 10;

export type Orientation = 'H' | 'V';

export type ShipId = 'carrier' | 'battleship' | 'cruiser' | 'submarine' | 'destroyer';

export interface Ship {
  id: ShipId;
  name: string;
  size: number;
}

export interface Placement {
  shipId: ShipId;
  row: number;
  col: number;
  orientation: Orientation;
}

export type ShotResult = 'miss' | 'hit';

export interface Board {
  placements: Placement[];
  /** index -> outcome. Absence means the cell has not been fired at. */
  shots: Record<number, ShotResult>;
}

export interface FireOutcome {
  board: Board;
  result: 'miss' | 'hit' | 'sunk' | 'repeat';
  shipId?: ShipId;
  /** Cells of the ship that just sank, revealed to the shooter. */
  sunkCells?: number[];
}

export const FLEET: Ship[] = [
  { id: 'carrier', name: 'Carrier', size: 5 },
  { id: 'battleship', name: 'Battleship', size: 4 },
  { id: 'cruiser', name: 'Cruiser', size: 3 },
  { id: 'submarine', name: 'Submarine', size: 3 },
  { id: 'destroyer', name: 'Destroyer', size: 2 },
];

export function shipById(id: ShipId): Ship {
  const ship = FLEET.find((s) => s.id === id);
  if (!ship) throw new Error(`unknown ship ${id}`);
  return ship;
}

export const toIndex = (row: number, col: number) => row * BOARD_SIZE + col;
export const toRow = (index: number) => Math.floor(index / BOARD_SIZE);
export const toCol = (index: number) => index % BOARD_SIZE;
