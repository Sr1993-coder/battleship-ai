import { describe, expect, it } from 'vitest';
import { AiKnowledge, chooseShot, densityMap, followUpTargets, newAiState } from '../game/ai';
import { fire, randomBoard, shipCellsOf, sunkShips } from '../game/board';
import { Board, ShotResult, toIndex } from '../game/types';
import { mulberry32 } from '../game/rng';

function knowledge(shots: Record<number, ShotResult>, sunkCells: number[] = []): AiKnowledge {
  return { shots, sunkCells, sunkShipIds: [] };
}

describe('ai targeting', () => {
  it('follows up next to an unresolved hit', () => {
    const state = newAiState('hunter');
    const move = chooseShot(knowledge({ [toIndex(5, 5)]: 'hit' }), state, mulberry32(1));
    const expected = [toIndex(4, 5), toIndex(6, 5), toIndex(5, 4), toIndex(5, 6)];
    expect(expected).toContain(move.index);
  });

  it('extends along a line of two hits', () => {
    const shots = { [toIndex(5, 5)]: 'hit' as const, [toIndex(5, 6)]: 'hit' as const };
    const move = chooseShot(knowledge(shots), newAiState('hunter'), mulberry32(1));
    expect([toIndex(5, 4), toIndex(5, 7)]).toContain(move.index);
  });

  it('ignores hits belonging to a ship that already sank', () => {
    const sunk = [toIndex(0, 0), toIndex(0, 1)];
    const shots = { [sunk[0]]: 'hit' as const, [sunk[1]]: 'hit' as const };
    const move = chooseShot(knowledge(shots, sunk), newAiState('hunter'), mulberry32(3));
    expect(sunk).not.toContain(move.index);
  });

  it('never fires at the same cell twice', () => {
    const shots: Record<number, ShotResult> = {};
    for (let i = 0; i < 99; i++) shots[i] = 'miss';
    const move = chooseShot(knowledge(shots), newAiState('admiral'), mulberry32(7));
    expect(move.index).toBe(99);
  });

  it('density map gives no weight to cells already fired at', () => {
    const shots = { [toIndex(0, 0)]: 'miss' as const };
    const density = densityMap(knowledge(shots));
    expect(density[toIndex(0, 0)]).toBe(0);
    expect(density[toIndex(4, 4)]).toBeGreaterThan(0);
  });
});

function playSoloGame(difficulty: 'random' | 'hunter' | 'admiral', seed: number): number {
  const rng = mulberry32(seed);
  let board: Board = randomBoard(rng);
  let state = newAiState(difficulty);
  let shots = 0;
  while (board.placements.some((p) => !sunkShips(board).includes(p.shipId))) {
    const sunkIds = sunkShips(board);
    const move = chooseShot(
      {
        shots: board.shots,
        sunkCells: sunkIds.flatMap((id) => shipCellsOf(board, id)),
        sunkShipIds: sunkIds,
      },
      state,
      rng,
    );
    const outcome = fire(board, move.index);
    expect(outcome.result).not.toBe('repeat');
    board = outcome.board;
    state = move.state;
    shots++;
    if (shots > 100) break;
  }
  return shots;
}

describe('ai strength', () => {
  it('each difficulty finishes a board, and smarter levels need fewer shots', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const average = (d: 'random' | 'hunter' | 'admiral') =>
      seeds.reduce((sum, seed) => sum + playSoloGame(d, seed), 0) / seeds.length;
    const random = average('random');
    const hunter = average('hunter');
    const admiral = average('admiral');
    expect(hunter).toBeLessThan(random);
    expect(admiral).toBeLessThan(hunter);
    expect(admiral).toBeLessThan(60);
  });
});

describe('grid edge handling', () => {
  it('does not treat hits on opposite edges as a line', () => {
    // Indices 59 and 60 are neighbours in the flat array but sit on opposite
    // sides of the board, so they cannot belong to the same ship.
    const shots = { [toIndex(5, 9)]: 'hit' as const, [toIndex(6, 0)]: 'hit' as const };
    const targets = followUpTargets(knowledge(shots)).sort((a, b) => a - b);
    const expected = [
      toIndex(4, 9),
      toIndex(5, 8),
      toIndex(6, 9),
      toIndex(5, 0),
      toIndex(6, 1),
      toIndex(7, 0),
    ].sort((a, b) => a - b);
    expect(targets).toEqual(expected);
  });
});
