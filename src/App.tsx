import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BoardView, { cellName } from './components/BoardView';
import FleetStatus from './components/FleetStatus';
import {
  DEFAULT_RULES,
  canPlace,
  emptyBoard,
  fire,
  fleetDestroyed,
  placeShip,
  previewCells,
  randomBoard,
  shipCellsOf,
  sunkShips,
} from './game/board';
import { AiKnowledge, AiState, Difficulty, chooseShot, newAiState } from './game/ai';
import { Ephemeris, eclipticLongitude, fetchEphemeris, seedFromEphemeris } from './game/ephemeris';
import { mulberry32 } from './game/rng';
import { Board, FLEET, Orientation, Placement, shipById } from './game/types';

type Phase = 'placing' | 'battle' | 'over';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  random: 'Cadet (random fire)',
  hunter: 'Officer (hunt & target)',
  admiral: 'Admiral (probability map)',
};

function knowledgeOf(board: Board): AiKnowledge {
  const sunkShipIds = sunkShips(board);
  const sunkCells = sunkShipIds.flatMap((id) => shipCellsOf(board, id));
  return { shots: board.shots, sunkCells, sunkShipIds };
}

export default function App() {
  const [ephemeris, setEphemeris] = useState<Ephemeris | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('hunter');
  const [phase, setPhase] = useState<Phase>('placing');
  const [playerBoard, setPlayerBoard] = useState<Board>(emptyBoard);
  const [aiBoard, setAiBoard] = useState<Board>(emptyBoard);
  const [aiState, setAiState] = useState<AiState>(() => newAiState('hunter'));
  const [orientation, setOrientation] = useState<Orientation>('H');
  const [hover, setHover] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [turn, setTurn] = useState<'player' | 'ai'>('player');
  const rngRef = useRef(mulberry32(Date.now()));

  useEffect(() => {
    const controller = new AbortController();
    fetchEphemeris(controller.signal).then((data) => {
      setEphemeris(data);
      const seed = seedFromEphemeris(data);
      rngRef.current = mulberry32(seed);
      setAiBoard(randomBoard(rngRef.current));
    });
    return () => controller.abort();
  }, []);

  const placedIds = playerBoard.placements.map((p) => p.shipId);
  const nextShip = FLEET.find((s) => !placedIds.includes(s.id));

  const preview = useMemo(() => {
    if (phase !== 'placing' || hover === null || !nextShip) return [];
    const placement: Placement = {
      shipId: nextShip.id,
      row: Math.floor(hover / 10),
      col: hover % 10,
      orientation,
    };
    return previewCells(placement);
  }, [phase, hover, nextShip, orientation]);

  const previewValid = useMemo(() => {
    if (phase !== 'placing' || hover === null || !nextShip) return true;
    return canPlace(
      playerBoard,
      { shipId: nextShip.id, row: Math.floor(hover / 10), col: hover % 10, orientation },
      DEFAULT_RULES,
    );
  }, [phase, hover, nextShip, orientation, playerBoard]);

  const addLog = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, 60));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'r') setOrientation((o) => (o === 'H' ? 'V' : 'H'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handlePlace(index: number) {
    if (!nextShip) return;
    const placement: Placement = {
      shipId: nextShip.id,
      row: Math.floor(index / 10),
      col: index % 10,
      orientation,
    };
    if (!canPlace(playerBoard, placement, DEFAULT_RULES)) return;
    const next = placeShip(playerBoard, placement, DEFAULT_RULES);
    setPlayerBoard(next);
    if (next.placements.length === FLEET.length) {
      setPhase('battle');
      addLog('All ships deployed. Open fire when ready.');
    }
  }

  function autoPlace() {
    const board = randomBoard(rngRef.current);
    setPlayerBoard(board);
    setPhase('battle');
    addLog('Fleet deployed automatically from the orbital seed.');
  }

  function resetPlacement() {
    setPlayerBoard(emptyBoard());
    setPhase('placing');
    setLog([]);
  }

  function newGame() {
    setPlayerBoard(emptyBoard());
    setAiBoard(randomBoard(rngRef.current));
    setAiState(newAiState(difficulty));
    setPhase('placing');
    setTurn('player');
    setLog([]);
  }

  function playerFire(index: number) {
    if (phase !== 'battle' || turn !== 'player') return;
    const outcome = fire(aiBoard, index);
    if (outcome.result === 'repeat') return;
    setAiBoard(outcome.board);
    if (outcome.result === 'sunk') {
      addLog(`You sank the enemy ${shipById(outcome.shipId!).name}! (${cellName(index)})`);
    } else {
      addLog(`You fired at ${cellName(index)} - ${outcome.result}.`);
    }
    if (fleetDestroyed(outcome.board)) {
      setPhase('over');
      addLog('Enemy fleet destroyed. You win.');
      return;
    }
    setTurn('ai');
  }

  useEffect(() => {
    if (phase !== 'battle' || turn !== 'ai') return;
    const timer = setTimeout(() => {
      const move = chooseShot(knowledgeOf(playerBoard), aiState, rngRef.current);
      const outcome = fire(playerBoard, move.index);
      setAiState(move.state);
      setPlayerBoard(outcome.board);
      if (outcome.result === 'sunk') {
        addLog(`Enemy sank your ${shipById(outcome.shipId!).name}! (${cellName(move.index)})`);
      } else {
        addLog(`Enemy fired at ${cellName(move.index)} - ${outcome.result}.`);
      }
      if (fleetDestroyed(outcome.board)) {
        setPhase('over');
        addLog('Your fleet is gone. The AI wins.');
        return;
      }
      setTurn('player');
    }, 550);
    return () => clearTimeout(timer);
  }, [phase, turn, playerBoard, aiState, addLog]);

  const orbits = ephemeris?.planets.map((p) => ({
    name: p.name,
    longitude: eclipticLongitude(p).toFixed(1),
  }));

  return (
    <div className="app">
      <header>
        <h1>Orbital Battleship</h1>
        <p className="sub">
          Ten by ten grid, five ships, one stubborn AI. The board seed comes from where the planets
          actually are right now.
        </p>
      </header>

      <section className="controls">
        <label>
          Difficulty
          <select
            value={difficulty}
            onChange={(e) => {
              const next = e.target.value as Difficulty;
              setDifficulty(next);
              setAiState(newAiState(next));
            }}
          >
            {Object.entries(DIFFICULTY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {phase === 'placing' && (
          <>
            <button type="button" onClick={() => setOrientation((o) => (o === 'H' ? 'V' : 'H'))}>
              Orientation: {orientation === 'H' ? 'horizontal' : 'vertical'} (R)
            </button>
            <button type="button" onClick={autoPlace}>
              Random fleet
            </button>
            <button type="button" onClick={resetPlacement}>
              Clear
            </button>
          </>
        )}
        {phase !== 'placing' && (
          <button type="button" onClick={newGame}>
            New game
          </button>
        )}
      </section>

      <p className="status">
        {phase === 'placing' && nextShip
          ? `Place your ${nextShip.name} (${nextShip.size} cells). Press R to rotate.`
          : null}
        {phase === 'battle'
          ? turn === 'player'
            ? 'Your turn - pick a target on the enemy grid.'
            : 'Enemy is taking aim...'
          : null}
        {phase === 'over' ? 'Game over.' : null}
      </p>

      <div className="boards">
        <div>
          <h2>Your waters</h2>
          <BoardView
            board={playerBoard}
            revealShips
            disabled={phase !== 'placing'}
            onCellClick={phase === 'placing' ? handlePlace : undefined}
            onCellEnter={phase === 'placing' ? setHover : undefined}
            preview={preview}
            previewValid={previewValid}
          />
          <FleetStatus board={playerBoard} title="Your fleet" />
        </div>
        <div>
          <h2>Enemy waters</h2>
          <BoardView
            board={aiBoard}
            revealShips={phase === 'over'}
            disabled={phase !== 'battle' || turn !== 'player'}
            onCellClick={playerFire}
          />
          <FleetStatus board={aiBoard} title="Enemy fleet" hideDamage={phase !== 'over'} />
        </div>
      </div>

      <section className="log">
        <h3>Battle log</h3>
        <ul>
          {log.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ul>
      </section>

      <footer>
        {ephemeris ? (
          <span>
            Seed epoch {ephemeris.epoch} ({ephemeris.source}) -{' '}
            {orbits?.map((o) => `${o.name} ${o.longitude}\u00b0`).join(', ')}
          </span>
        ) : (
          <span>Reading planetary positions...</span>
        )}
      </footer>
    </div>
  );
}
