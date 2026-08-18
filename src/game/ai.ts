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

/** The eight cells around one, clipped to the board. */
function touching(index: number): number[] {
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

function remainingSizes(knowledge: AiKnowledge): number[] {
  const sunk = new Set(knowledge.sunkShipIds);
  return FLEET.filter((s) => !sunk.has(s.id)).map((s) => s.size);
}

/**
 * Follow-up cells for the unresolved hits. When two or more hits line up we
 * extend along that line first, which is how a decent human plays.
 */
export function followUpTargets(knowledge: AiKnowledge): number[] {
  const hits = activeHits(knowledge);
  if (hits.length === 0) return [];

  const hitSet = new Set(hits);
  const open = (i: number) => knowledge.shots[i] === undefined;
  const inLine: number[] = [];

  /** Grid-aware lookup: returns null outside the board instead of wrapping. */
  const cellAt = (row: number, col: number): number | null =>
    row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE ? null : toIndex(row, col);
  const isHit = (row: number, col: number) => {
    const cell = cellAt(row, col);
    return cell !== null && hitSet.has(cell);
  };

  /** Walks away from a hit along one axis and returns the first open cell. */
  const extend = (row: number, col: number, dr: number, dc: number): number | null => {
    let r = row;
    let c = col;
    while (isHit(r, c)) {
      r += dr;
      c += dc;
    }
    const cell = cellAt(r, c);
    return cell !== null && open(cell) ? cell : null;
  };

  for (const hit of hits) {
    const row = toRow(hit);
    const col = toCol(hit);
    const axes: Array<[number, number]> = [];
    if (isHit(row, col - 1) || isHit(row, col + 1)) axes.push([0, 1]);
    if (isHit(row - 1, col) || isHit(row + 1, col)) axes.push([1, 0]);
    for (const [dr, dc] of axes) {
      for (const sign of [1, -1]) {
        const cell = extend(row, col, dr * sign, dc * sign);
        if (cell !== null) inLine.push(cell);
      }
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
  // Ships may not touch, so nothing can sit next to a ship that has sunk -
  // those cells are known-empty even though they have never been fired at.
  const beside = new Set<number>();
  for (const cell of knowledge.sunkCells) for (const n of touching(cell)) beside.add(n);
  const blocked = (i: number) => knowledge.shots[i] === 'miss' || sunk.has(i) || beside.has(i);

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
          // The base count over an untouched board reaches 34, so the bonus for
          // explaining a hit has to be well clear of that to actually dominate.
          const weight = covered > 0 ? Math.pow(1000, covered) : 1;
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
    // The queue only carries the order to work through; which cells are still
    // worth firing at is recomputed every turn, so cells left over from a ship
    // that has since sunk drop out instead of wasting shots on the wreck.
    const followUps = followUpTargets(knowledge);
    const live = new Set(followUps);
    const queue = state.targets.filter((i) => live.has(i));
    const targets = queue.length > 0 ? queue : followUps;
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
