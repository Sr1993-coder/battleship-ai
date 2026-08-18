import {
  BOARD_SIZE,
  FLEET,
  Orientation,
  ShipId,
  ShotResult,
  toCol,
  toIndex,
  toRow,
} from './types';
import { Rng } from './rng';

export type Difficulty = 'random' | 'hunter' | 'admiral';

/** Everything the AI is allowed to know about the human board. */
export interface AiKnowledge {
  shots: Record<number, ShotResult>;
  /** Cells revealed as part of a ship that has already sunk. */
  sunkCells: number[];
  sunkShipIds: ShipId[];
}

export interface AiState {
  difficulty: Difficulty;
  /** Cells queued for follow-up after a hit (hunter mode). */
  targets: number[];
}

export function newAiState(difficulty: Difficulty): AiState {
  return { difficulty, targets: [] };
}

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

function untouched(knowledge: AiKnowledge): number[] {
  const out: number[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    if (knowledge.shots[i] === undefined) out.push(i);
  }
  return out;
}

function activeHits(knowledge: AiKnowledge): number[] {
  const sunk = new Set(knowledge.sunkCells);
  return Object.entries(knowledge.shots)
    .filter(([index, result]) => result === 'hit' && !sunk.has(Number(index)))
    .map(([index]) => Number(index));
}

function orthogonal(index: number): number[] {
  const row = toRow(index);
  const col = toCol(index);
  const out: number[] = [];
  if (row > 0) out.push(toIndex(row - 1, col));
  if (row < BOARD_SIZE - 1) out.push(toIndex(row + 1, col));
  if (col > 0) out.push(toIndex(row, col - 1));
  if (col < BOARD_SIZE - 1) out.push(toIndex(row, col + 1));
  return out;
}

function remainingSizes(knowledge: AiKnowledge): number[] {
  const sunk = new Set(knowledge.sunkShipIds);
  return FLEET.filter((s) => !sunk.has(s.id)).map((s) => s.size);
}

/**
 * Follow-up cells for the unresolved hits. When two or more hits line up we
 * extend along that line first, which is how a decent human plays.
 */
function followUpTargets(knowledge: AiKnowledge): number[] {
  const hits = activeHits(knowledge);
  if (hits.length === 0) return [];

  const hitSet = new Set(hits);
  const open = (i: number) => knowledge.shots[i] === undefined;
  const inLine: number[] = [];

  for (const hit of hits) {
    const row = toRow(hit);
    const col = toCol(hit);
    if (hitSet.has(toIndex(row, col + 1)) || hitSet.has(toIndex(row, col - 1))) {
      let c = col;
      while (hitSet.has(toIndex(row, c))) c++;
      if (c < BOARD_SIZE && open(toIndex(row, c))) inLine.push(toIndex(row, c));
      c = col;
      while (hitSet.has(toIndex(row, c))) c--;
      if (c >= 0 && open(toIndex(row, c))) inLine.push(toIndex(row, c));
    }
    if (row + 1 < BOARD_SIZE && hitSet.has(toIndex(row + 1, col))) {
      let r = row;
      while (r < BOARD_SIZE && hitSet.has(toIndex(r, col))) r++;
      if (r < BOARD_SIZE && open(toIndex(r, col))) inLine.push(toIndex(r, col));
    }
    if (row > 0 && hitSet.has(toIndex(row - 1, col))) {
      let r = row;
      while (r >= 0 && hitSet.has(toIndex(r, col))) r--;
      if (r >= 0 && open(toIndex(r, col))) inLine.push(toIndex(r, col));
    }
  }

  if (inLine.length > 0) return [...new Set(inLine)];
  return [...new Set(hits.flatMap(orthogonal).filter(open))];
}

/**
 * Counts, for every untouched cell, how many legal placements of the ships
 * still afloat would cover it. Placements that explain an unresolved hit are
 * weighted heavily, so the AI finishes a wounded ship before wandering off.
 */
export function densityMap(knowledge: AiKnowledge): number[] {
  const density = new Array<number>(CELL_COUNT).fill(0);
  const sunk = new Set(knowledge.sunkCells);
  const hits = new Set(activeHits(knowledge));
  const blocked = (i: number) => knowledge.shots[i] === 'miss' || sunk.has(i);

  for (const size of remainingSizes(knowledge)) {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        for (const orientation of ['H', 'V'] as Orientation[]) {
          const cells: number[] = [];
          for (let i = 0; i < size; i++) {
            const r = orientation === 'V' ? row + i : row;
            const c = orientation === 'H' ? col + i : col;
            if (r >= BOARD_SIZE || c >= BOARD_SIZE) {
              cells.length = 0;
              break;
            }
            cells.push(toIndex(r, c));
          }
          if (cells.length !== size) continue;
          if (cells.some(blocked)) continue;
          const covered = cells.filter((cell) => hits.has(cell)).length;
          const weight = covered > 0 ? Math.pow(30, covered) : 1;
          for (const cell of cells) {
            if (knowledge.shots[cell] === undefined) density[cell] += weight;
          }
        }
      }
    }
  }
  return density;
}

export interface AiMove {
  index: number;
  state: AiState;
}

export function chooseShot(knowledge: AiKnowledge, state: AiState, rng: Rng): AiMove {
  const open = untouched(knowledge);
  if (open.length === 0) throw new Error('no cells left to fire at');

  if (state.difficulty === 'random') {
    return { index: open[Math.floor(rng() * open.length)], state };
  }

  if (state.difficulty === 'hunter') {
    const queue = state.targets.filter((i) => knowledge.shots[i] === undefined);
    const targets = queue.length > 0 ? queue : followUpTargets(knowledge);
    if (targets.length > 0) {
      const index = targets[0];
      return { index, state: { ...state, targets: targets.slice(1) } };
    }
    // Hunting phase: ships are at least two cells long, so half the board is
    // enough to guarantee finding one.
    const parity = open.filter((i) => (toRow(i) + toCol(i)) % 2 === 0);
    const pool = parity.length > 0 ? parity : open;
    return { index: pool[Math.floor(rng() * pool.length)], state: { ...state, targets: [] } };
  }

  const density = densityMap(knowledge);
  let best: number[] = [];
  let bestScore = -1;
  for (const cell of open) {
    if (density[cell] > bestScore) {
      bestScore = density[cell];
      best = [cell];
    } else if (density[cell] === bestScore) {
      best.push(cell);
    }
  }
  if (bestScore <= 0) {
    return { index: open[Math.floor(rng() * open.length)], state };
  }
  return { index: best[Math.floor(rng() * best.length)], state };
}
