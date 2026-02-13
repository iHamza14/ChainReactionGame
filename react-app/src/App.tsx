import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

const ROWS = 15;
const COLS = 9;
const MAX_PLAYERS = 8;
const TONES = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'teal', 'pink'] as const;

type Tone = (typeof TONES)[number];

type Cell = {
  owner: number | null;
  count: number;
};

type RoomState = {
  roomCode: string;
  board: Cell[][];
  players: number[];
  currentPlayerId: number | null;
  hostId: number | null;
  hasStarted: boolean;
  isGameActive: boolean;
  winnerId: number | null;
};

type StatusTone = Tone | 'neutral';

type Status = {
  text: string;
  tone: StatusTone;
};

const createEmptyBoard = (): Cell[][] =>
  Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ owner: null, count: 0 })),
  );

const getToneForPlayer = (playerId: number | null): StatusTone => {
  if (playerId === null) return 'neutral';
  const index = (playerId - 1) % TONES.length;
  return TONES[index];
};

const ORB_IMAGE_BASE = '/orbs';

const getCellDisplay = (cell: Cell) => {
  if (cell.owner === null || cell.count === 0) {
    return { count: 0, tone: 'neutral' as const };
  }
  return { count: cell.count, tone: getToneForPlayer(cell.owner) };
};

const getOrbImagePath = (cell: Cell) => {
  if (cell.count === 0) {
    return `${ORB_IMAGE_BASE}/orb-p0-n0.png`;
  }
  if (cell.owner === null) {
    return null;
  }
  return `${ORB_IMAGE_BASE}/orb-p${cell.owner}-n${cell.count}.png`;
};

const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const getStatusMessage = (
  room: RoomState | null,
  myPlayerId: number | null,
  transientError: string | null,
): Status => {
  if (transientError) {
    return { text: transientError, tone: 'neutral' };
  }
  if (!room) {
    return { text: 'Connect to a room to start.', tone: 'neutral' };
  }
  if (room.winnerId) {
    return {
      text: `Player ${room.winnerId} won!`,
      tone: getToneForPlayer(room.winnerId),
    };
  }
  if (!room.hasStarted) {
    if (room.hostId === myPlayerId) {
      return { text: 'Start the game when ready.', tone: 'neutral' };
    }
    return { text: 'Waiting for host to start...', tone: 'neutral' };
  }
  if (!room.currentPlayerId) {
    return { text: 'Waiting for players...', tone: 'neutral' };
  }
  if (room.currentPlayerId === myPlayerId) {
    return {
      text: `Your move (Player ${room.currentPlayerId})`,
      tone: getToneForPlayer(room.currentPlayerId),
    };
  }
  return {
    text: `Waiting for Player ${room.currentPlayerId}...`,
    tone: getToneForPlayer(room.currentPlayerId),
  };
};
const MAX_ORB_COUNT=3
const getOrbKey = (cell: Cell) => {
  if (cell.owner === null || cell.count === 0) return 'p0-n0';
  const count = Math.min(cell.count, MAX_ORB_COUNT);
  return `p${cell.owner}-n${count}`;
};
import { ORB_IMAGES } from './orbImage';

const App = () => {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [myPlayerId, setMyPlayerId] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transientError, setTransientError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  // const ORB_IMAGES: Partial<Record<Tone, string>> = {};

  

  const status = useMemo(
    () => getStatusMessage(roomState, myPlayerId, transientError),
    [roomState, myPlayerId, transientError],
  );

  useEffect(() => () => socketRef.current?.close(), []);

  useEffect(() => {
    if (!transientError) return undefined;
    const timeout = setTimeout(() => setTransientError(null), 2000);
    return () => clearTimeout(timeout);
  }, [transientError]);

  const connectSocket = () => {
    if (
      socketRef.current &&
      socketRef.current.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
  
    if (socketRef.current) {
      socketRef.current.close();
    }
    if (socketRef.current) {
      socketRef.current.close();
    }
    // const socket = new WebSocket('ws://localhost:8080');
    console.log("PROD WS URL =", import.meta.env.VITE_WS_URL);
    const socket = new WebSocket(import.meta.env.VITE_WS_URL as string);
    socketRef.current = socket;
    setConnectionStatus('Connecting...');

    socket.onopen = () => setConnectionStatus('Connected');
    socket.onclose = () => setConnectionStatus('Disconnected');
    socket.onerror = () => setConnectionStatus('Connection error');

    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'error') {
        setTransientError(payload.message);
        return;
      }
      if (payload.type === 'joined') {
        setMyPlayerId(payload.playerId);
        setRoomCodeInput(payload.roomCode);
        setErrorMessage(null);
        return;
      }
      if (payload.type === 'roomState') {
        setRoomState(payload);
        return;
      }
      if (payload.type === 'roomDestroyed') {
        setRoomState(null);
        setMyPlayerId(null);
        setRoomCodeInput('');
        setErrorMessage('Room was destroyed.');
      }
    };
  };

  const createRoom = () => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      connectSocket();
      setErrorMessage('Connecting to server...');
      setTimeout(createRoom, 300);
      return;
    }
    const code = generateRoomCode();
    socketRef.current.send(JSON.stringify({ type: 'create', code }));
  };

  const joinRoom = () => {
    if (!roomCodeInput.trim()) {
      setErrorMessage('Enter a room code.');
      return;
    }
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      connectSocket();
      setErrorMessage('Connecting to server...');
      setTimeout(joinRoom, 300);
      return;
    }
    socketRef.current.send(JSON.stringify({ type: 'join', code: roomCodeInput.trim().toUpperCase() }));
  };

  const handleCellClick = (row: number, col: number) => {
    if (!roomState || !roomState.isGameActive) return;
    if (roomState.currentPlayerId !== myPlayerId) {
      setTransientError('Not your turn.');
      return;
    }
    socketRef.current?.send(JSON.stringify({ type: 'move', row, col }));
  };

  const startGame = () => {
    socketRef.current?.send(JSON.stringify({ type: 'start' }));
  };

  const restartGame = () => {
    socketRef.current?.send(JSON.stringify({ type: 'restart' }));
  };

  const destroyRoom = () => {
    socketRef.current?.send(JSON.stringify({ type: 'destroy' }));
  };

  const displayBoard = roomState?.board ?? createEmptyBoard();
  const players = roomState?.players ?? [];
  const isHost = roomState?.hostId === myPlayerId;

  return (
    <div className="app">
      <header className="header">
        <div className="title">Chain Reaction Online</div>
        {!roomState?.hasStarted && (
          <div className="connection">
            <div className="connection-status">{connectionStatus}</div>
            <div className="connection-actions">
              <button className="reset" type="button" onClick={createRoom}>
                Create Room
              </button>
              <div className="join-row">
                <input
                  className="room-input"
                  placeholder="Room Code"
                  value={roomCodeInput}
                  onChange={(event) => setRoomCodeInput(event.target.value)}
                  maxLength={6}
                />
                <button className="reset" type="button" onClick={joinRoom}>
                  Join
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {roomState && (
        <section className="room-info">
          <div>Room: {roomState.roomCode}</div>
          <div>Player: {myPlayerId ?? '--'}</div>
          <div>
            Players connected: {players.length}/{MAX_PLAYERS}
          </div>
          <div className="status room-status">
            <span className={`status-indicator status-indicator--${status.tone}`} aria-hidden />
            <span>{status.text}</span>
          </div>
          {!roomState.hasStarted && isHost && (
            <button className="reset" type="button" onClick={startGame}>
              Start
            </button>
          )}
          {roomState.hasStarted && isHost && (
            <button className="reset reset--danger" type="button" onClick={destroyRoom}>
              End Game
            </button>
          )}
          {errorMessage && <div className="error">{errorMessage}</div>}
        </section>
      )}

      <div
        className="board"
        role="grid"
        style={
          {
            '--row-count': ROWS,
            '--col-count': COLS,
          } as CSSProperties
        }
      >
        {displayBoard.map((row, rowIndex) => (
          <div className="board-row" role="row" key={`row-${rowIndex}`}>
            {row.map((cell, colIndex) => {
              const orbKey = getOrbKey(cell);
              const orbImage = ORB_IMAGES[orbKey];

              const orbClass = `orb ${orbKey === 'p0-n0' ? 'orb--empty' : 'orb--image'}`;
              const orbStyle =
                orbImage
                  ? ({ '--orb-image': `url(${orbImage})` } as CSSProperties)
                  : undefined;

              return (
                <button
                  key={`cell-${rowIndex}-${colIndex}`}
                  className="cell"
                  onClick={() => handleCellClick(rowIndex, colIndex)}
                  type="button"
                  aria-label={`row ${rowIndex + 1} column ${colIndex + 1}`}
                >
                  <span className={orbClass} style={orbStyle} aria-hidden />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {roomState?.winnerId && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Player {roomState.winnerId} wins!</h2>
            <p>Choose what to do next.</p>
            <div className="modal-actions">
              <button className="reset" type="button" onClick={restartGame}>
                Restart Game
              </button>
              <button className="reset reset--danger" type="button" onClick={destroyRoom}>
                Destroy Room
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
