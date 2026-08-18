import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canPlace, emptyBoard, fire, occupiedCells, placementCells, randomBoard, sunkShips, shipCellsOf } from '../game/board';
import { AiKnowledge, Difficulty, chooseShot, newAiState } from '../game/ai';
import { BOARD_SIZE, Board, FLEET, Orientation, ShipId } from '../game/types';
import { mulberry32 } from '../game/rng';

const shipIds = FLEET.map((s) => s.id);

const arbPlacement = fc.record({
  shipId: fc.constantFrom<ShipId>(...(shipIds as ShipId[])),
  row: fc.integer({ min: -2, max: 11 }),
  col: fc.integer({ min: -2, max: 11 }),
  orientation: fc.constantFrom<Orientation>('H', 'V'),
});

describe('placement invariants', () => {
  it('accepted placements stay inside the grid', () => {
    fc.assert(
      fc.property(arbPlacement, (placement) => {
        if (!canPlace(emptyBoard(), placement)) return true;
        return placementCells(placement).every((c) => c >= 0 && c < BOARD_SIZE * BOARD_SIZE);
      }),
      { numRuns: 3000 },
    );
  });

  it('random fleets never overlap and never touch', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), (seed) => {
        const board = randomBoard(mulberry32(seed));
        const occupied = occupiedCells(board);
        expect(occupied.size).toBe(FLEET.reduce((sum, s) => sum + s.size, 0));
        for (const [cell, shipId] of occupied) {
          const row = Math.floor(cell / BOARD_SIZE);
          const col = cell % BOARD_SIZE;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const r = row + dr;
              const c = col + dc;
              if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) continue;
              const other = occupied.get(r * BOARD_SIZE + c);
              if (other && other !== shipId) {
                throw new Error(`ships ${shipId} and ${other} are adjacent`);
              }
            }
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});

function knowledgeFor(board: Board): AiKnowledge {
  const sunkShipIds = sunkShips(board);
  return {
    shots: board.shots,
    sunkCells: sunkShipIds.flatMap((id) => shipCellsOf(board, id)),
    sunkShipIds,
  };
}

/** Plays a full AI-vs-board game and asserts the engine never misbehaves. */
function playThrough(difficulty: Difficulty, seed: number) {
  const rng = mulberry32(seed);
  let board = randomBoard(rng);
  let state = newAiState(difficulty);
  const fired = new Set<number>();
  let turns = 0;

  while (sunkShips(board).length < FLEET.length) {
    turns++;
    if (turns > BOARD_SIZE * BOARD_SIZE) {
      throw new Error(`game did not finish within ${BOARD_SIZE * BOARD_SIZE} turns`);
    }
    const move = chooseShot(knowledgeFor(board), state, rng);
    if (fired.has(move.index)) throw new Error(`AI repeated a shot at ${move.index}`);
    fired.add(move.index);
    const outcome = fire(board, move.index);
    if (outcome.result === 'repeat') throw new Error('engine accepted a repeated shot');
    board = outcome.board;
    state = move.state;
  }

  // Every hit on the board must belong to a ship, and every ship cell must be hit.
  const occupied = occupiedCells(board);
  for (const [cell] of occupied) {
    if (board.shots[cell] !== 'hit') throw new Error('fleet reported sunk with a cell unhit');
  }
  for (const [cell, result] of Object.entries(board.shots)) {
    if (result === 'hit' && !occupied.has(Number(cell))) {
      throw new Error('hit recorded on empty water');
    }
  }
}

describe('full game fuzzing', () => {
  it('completes thousands of games with no illegal state', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Difficulty>('random', 'hunter', 'admiral'),
        fc.integer({ min: 0, max: 1000000 }),
        (difficulty, seed) => {
          playThrough(difficulty, seed);
          return true;
        },
      ),
      { numRuns: 400 },
    );
  });
});
