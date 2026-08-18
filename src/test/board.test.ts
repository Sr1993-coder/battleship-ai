import { describe, expect, it } from 'vitest';
import {
  canPlace,
  emptyBoard,
  fire,
  fleetDestroyed,
  isSunk,
  placeShip,
  placementCells,
  previewCells,
  randomBoard,
  remainingShips,
} from '../game/board';
import { BOARD_SIZE, FLEET, Placement, toIndex } from '../game/types';
import { mulberry32 } from '../game/rng';

const destroyer = (row: number, col: number, orientation: 'H' | 'V' = 'H'): Placement => ({
  shipId: 'destroyer',
  row,
  col,
  orientation,
});

describe('placement', () => {
  it('keeps ships on the board', () => {
    expect(canPlace(emptyBoard(), destroyer(0, 9))).toBe(false);
    expect(canPlace(emptyBoard(), destroyer(9, 8))).toBe(true);
    expect(canPlace(emptyBoard(), { shipId: 'carrier', row: 6, col: 0, orientation: 'V' })).toBe(
      false,
    );
  });

  it('rejects overlapping and touching ships', () => {
    const board = placeShip(emptyBoard(), { shipId: 'cruiser', row: 4, col: 4, orientation: 'H' });
    expect(canPlace(board, destroyer(4, 4))).toBe(false);
    expect(canPlace(board, destroyer(3, 3))).toBe(false); // diagonal contact
    expect(canPlace(board, destroyer(4, 7))).toBe(false); // edge contact
    expect(canPlace(board, destroyer(0, 0))).toBe(true);
  });

  it('allows touching ships when the rule is relaxed', () => {
    const board = placeShip(emptyBoard(), { shipId: 'cruiser', row: 4, col: 4, orientation: 'H' });
    expect(canPlace(board, destroyer(3, 3), { allowTouching: true })).toBe(true);
  });

  it('never places the same ship twice', () => {
    const board = placeShip(emptyBoard(), destroyer(0, 0));
    expect(canPlace(board, destroyer(5, 5))).toBe(false);
  });

  it('lays out a full fleet from a seed', () => {
    const board = randomBoard(mulberry32(42));
    expect(board.placements).toHaveLength(FLEET.length);
    const cells = board.placements.flatMap(placementCells);
    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe('firing', () => {
  it('reports miss, hit, sunk and repeat', () => {
    const board = placeShip(emptyBoard(), destroyer(0, 0));
    expect(fire(board, toIndex(5, 5)).result).toBe('miss');
    const first = fire(board, toIndex(0, 0));
    expect(first.result).toBe('hit');
    expect(fire(first.board, toIndex(0, 0)).result).toBe('repeat');
    const second = fire(first.board, toIndex(0, 1));
    expect(second.result).toBe('sunk');
    expect(second.sunkCells).toEqual([toIndex(0, 0), toIndex(0, 1)]);
    expect(fleetDestroyed(second.board)).toBe(true);
  });

  it('does not treat an empty board as a destroyed fleet', () => {
    expect(fleetDestroyed(emptyBoard())).toBe(false);
    expect(isSunk(emptyBoard(), 'carrier')).toBe(false);
  });

  it('rejects shots off the board', () => {
    expect(() => fire(emptyBoard(), -1)).toThrow();
    expect(() => fire(emptyBoard(), BOARD_SIZE * BOARD_SIZE)).toThrow();
  });

  it('tracks the ships still afloat', () => {
    const board = placeShip(emptyBoard(), destroyer(0, 0));
    expect(remainingShips(board)).toEqual(['destroyer']);
    const sunkBoard = fire(fire(board, toIndex(0, 0)).board, toIndex(0, 1)).board;
    expect(remainingShips(sunkBoard)).toEqual([]);
  });
});

describe('placement preview', () => {
  it('does not spill onto the next row when a ship overhangs the edge', () => {
    const cells = previewCells({ shipId: 'carrier', row: 3, col: 8, orientation: 'H' });
    expect(cells).toEqual([toIndex(3, 8), toIndex(3, 9)]);
  });

  it('stops at the bottom edge for vertical ships', () => {
    const cells = previewCells({ shipId: 'cruiser', row: 9, col: 2, orientation: 'V' });
    expect(cells).toEqual([toIndex(9, 2)]);
  });
});
