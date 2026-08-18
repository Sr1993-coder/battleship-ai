import { AiKnowledge, AiState, Difficulty, chooseShot, newAiState } from './ai';
import { fire, fleetDestroyed, randomBoard, shipCellsOf, sunkShips } from './board';
import { Board, BOARD_SIZE } from './types';
import { Rng, mulberry32 } from './rng';

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/** Everything an AI is allowed to know about the board it is shooting at. */
export function knowledgeOf(board: Board): AiKnowledge {
  const sunkShipIds = sunkShips(board);
  const sunkCells = sunkShipIds.flatMap((id) => shipCellsOf(board, id));
  return { shots: board.shots, sunkCells, sunkShipIds };
}

/** Plays one difficulty against one random fleet and returns the shots used. */
export function playSoloGame(difficulty: Difficulty, rng: Rng): number {
  let board = randomBoard(rng);
  let state: AiState = newAiState(difficulty);
  let shots = 0;

  while (!fleetDestroyed(board)) {
    if (shots > CELL_COUNT) throw new Error('game did not finish within the board');
    const move = chooseShot(knowledgeOf(board), state, rng);
    state = move.state;
    board = fire(board, move.index).board;
    shots++;
  }
  return shots;
}

export interface Benchmark {
  difficulty: Difficulty;
  games: number;
  mean: number;
  best: number;
  worst: number;
  /** Shots below which half the games finish. */
  median: number;
}

export function benchmark(difficulty: Difficulty, games: number, seed: number): Benchmark {
  const rng = mulberry32(seed);
  const results: number[] = [];
  for (let i = 0; i < games; i++) results.push(playSoloGame(difficulty, rng));
  results.sort((a, b) => a - b);
  const total = results.reduce((sum, n) => sum + n, 0);
  return {
    difficulty,
    games,
    mean: total / games,
    best: results[0],
    worst: results[results.length - 1],
    median: results[Math.floor(games / 2)],
  };
}
