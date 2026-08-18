import { describe, expect, it } from 'vitest';
import { AiKnowledge, densityMap } from '../game/ai';
import { canPlace, emptyBoard, placeShip, placementCells } from '../game/board';
import { BOARD_SIZE, Board, FLEET, Placement, ShotResult } from '../game/types';
import { mulberry32 } from '../game/rng';

/**
 * A deliberately slow, obviously-correct reference: sample complete fleets that
 * are consistent with what has been fired at so far, using the same legality
 * rules the game uses to lay a fleet out, and count how often each cell ends up
 * holding a ship. Whatever this says is impossible really is impossible, so the
 * fast densityMap must never point the AI at one of those cells.
 */
function oracle(
  shots: Record<number, ShotResult>,
  fixed: Placement[],
  samples: number,
): number[] {
  const misses = new Set(
    Object.entries(shots)
      .filter(([, result]) => result === 'miss')
      .map(([index]) => Number(index)),
  );
  const fixedIds = new Set(fixed.map((p) => p.shipId));
  const rng = mulberry32(1);
  const counts = new Array<number>(BOARD_SIZE * BOARD_SIZE).fill(0);

  let taken = 0;
  for (let attempt = 0; attempt < samples * 4 && taken < samples; attempt++) {
    let board: Board = emptyBoard();
    for (const placement of fixed) board = placeShip(board, placement);

    let complete = true;
    for (const ship of FLEET.filter((s) => !fixedIds.has(s.id))) {
      const options: Placement[] = [];
      for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
          for (const orientation of ['H', 'V'] as const) {
            const candidate: Placement = { shipId: ship.id, row, col, orientation };
            if (!canPlace(board, candidate)) continue;
            if (placementCells(candidate).some((cell) => misses.has(cell))) continue;
            options.push(candidate);
          }
        }
      }
      if (options.length === 0) {
        complete = false;
        break;
      }
      board = placeShip(board, options[Math.floor(rng() * options.length)]);
    }
    if (!complete) continue;

    taken++;
    for (const placement of board.placements) {
      if (fixedIds.has(placement.shipId)) continue;
      for (const cell of placementCells(placement)) counts[cell]++;
    }
  }

  expect(taken).toBe(samples);
  return counts.map((count) => count / samples);
}

describe('density map against a reference oracle', () => {
  it('never targets a cell no remaining ship can occupy', () => {
    // The Destroyer sank on A1-B1 and two shots missed in the middle.
    const shots: Record<number, ShotResult> = { 0: 'hit', 1: 'hit', 44: 'miss', 45: 'miss' };
    const knowledge: AiKnowledge = { shots, sunkCells: [0, 1], sunkShipIds: ['destroyer'] };
    const destroyer: Placement = { shipId: 'destroyer', row: 0, col: 0, orientation: 'H' };

    const truth = oracle(shots, [destroyer], 4000);
    const density = densityMap(knowledge);

    for (let cell = 0; cell < BOARD_SIZE * BOARD_SIZE; cell++) {
      if (shots[cell] !== undefined) continue;
      if (truth[cell] === 0) expect(density[cell]).toBe(0);
    }
  });
});
