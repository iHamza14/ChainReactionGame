import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
});

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});


const MAX_PLAYERS = 8;
const ROWS = 15;
const COLS = 9;

const createEmptyBoard = () =>
  Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ owner: null, count: 0 })),
  );

const getNeighbors = (row, col) => {
  const neighbors = [];
  if (row > 0) neighbors.push([row - 1, col]);
  if (row < ROWS - 1) neighbors.push([row + 1, col]);
  if (col > 0) neighbors.push([row, col - 1]);
  if (col < COLS - 1) neighbors.push([row, col + 1]);
  return neighbors;
};

const getCriticalMass = (row, col) => getNeighbors(row, col).length;

const cloneBoard = (board) => board.map((row) => row.map((cell) => ({ ...cell })));

const hasOrbs = (board, playerId) =>
  board.some((row) => row.some((cell) => cell.owner === playerId && cell.count > 0));

const applyMove = (board, row, col, playerId) => {
  const queue = [[row, col]];
  while (queue.length) {
    const [currentRow, currentCol] = queue.shift();
    const cell = board[currentRow][currentCol];
    const nextCount = cell.count + 1;
    const criticalMass = getCriticalMass(currentRow, currentCol);
    if (nextCount >= criticalMass) {
      board[currentRow][currentCol] = { owner: null, count: 0 };
      getNeighbors(currentRow, currentCol).forEach((neighbor) => queue.push(neighbor));
    } else {
      board[currentRow][currentCol] = { owner: playerId, count: nextCount };
    }
  }
};

const checkForWinner = (board, players, movesMade) => {
  if (movesMade.size < players.length) {
    return null;
  }
  const alive = new Set();
  board.forEach((row) => {
    row.forEach((cell) => {
      if (cell.owner !== null) {
        alive.add(cell.owner);
      }
    });
  });
  if (alive.size === 1) {
    return [...alive][0];
  }
  return null;
};

const updateEliminations = (room) => {
  room.players.forEach((playerId) => {
    if (room.movesMade.has(playerId) && !hasOrbs(room.board, playerId)) {
      room.eliminatedPlayers.add(playerId);
    }
  });
};

const getNextPlayerIndex = (room, startIndex) => {
  if (room.players.length === 0) return 0;
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidateIndex = (startIndex + offset) % room.players.length;
    const candidateId = room.players[candidateIndex];
    if (!room.eliminatedPlayers.has(candidateId)) {
      return candidateIndex;
    }
  }
  return startIndex;
};

const createRoom = (code) => ({
  code,
  board: createEmptyBoard(),
  players: [],
  currentPlayerIndex: 0,
  movesMade: new Set(),
  eliminatedPlayers: new Set(),
  hostId: null,
  hasStarted: false,
  isGameActive: false,
  winnerId: null,
  nextPlayerId: 1,
});

const rooms = new Map();

// const wss = new WebSocketServer({ port: PORT });

const broadcastState = (room) => {
  const state = {
    type: 'roomState',
    roomCode: room.code,
    board: room.board,
    players: room.players,
    currentPlayerId: room.players[room.currentPlayerIndex] ?? null,
    hostId: room.hostId,
    hasStarted: room.hasStarted,
    isGameActive: room.isGameActive,
    winnerId: room.winnerId,
  };
  room.players.forEach((playerId) => {
    const client = clientsById.get(playerId);
    if (client && client.readyState === client.OPEN) {
      client.send(JSON.stringify(state));
    }
  });
};

const clientsById = new Map();
const clientRoom = new Map();
const clientPlayerId = new Map();

const reassignPlayerIds = (room) => {
  const playerIdMap = new Map();
  const newPlayers = room.players.map((oldId, index) => {
    const newId = index + 1;
    playerIdMap.set(oldId, newId);
    return newId;
  });

  room.players.forEach((oldId) => {
    const client = clientsById.get(oldId);
    if (!client) return;
    const newId = playerIdMap.get(oldId);
    clientsById.delete(oldId);
    clientsById.set(newId, client);
    clientPlayerId.set(client, newId);
    client.send(
      JSON.stringify({
        type: 'joined',
        playerId: newId,
        roomCode: room.code,
      }),
    );
  });

  room.players = newPlayers;
  room.hostId = room.hostId ? playerIdMap.get(room.hostId) ?? null : null;
  room.nextPlayerId = room.players.length + 1;
};

const sendError = (client, message) => {
  client.send(JSON.stringify({ type: 'error', message }));
};

wss.on('connection', (ws,req) => {
  console.log("CLIENT CONNECTED FROM", req.socket.remoteAddress);

  ws.on("close", () => console.log("CLIENT DISCONNECTED"));

  ws.on('message', (data) => {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      sendError(ws, 'Invalid message payload.');
      return;
    }

    if (payload.type === 'create') {
      const code = payload.code;
      if (!code) {
        sendError(ws, 'Room code required.');
        return;
      }
      if (rooms.has(code)) {
        sendError(ws, 'Room code already exists.');
        return;
      }
      const room = createRoom(code);
      rooms.set(code, room);
      joinRoom(ws, room);
      return;
    }

    if (payload.type === 'join') {
      const room = rooms.get(payload.code);
      if (!room) {
        sendError(ws, 'Room not found.');
        return;
      }
      if (room.hasStarted) {
        sendError(ws, 'Game already started.');
        return;
      }
      if (room.players.length >= MAX_PLAYERS) {
        sendError(ws, 'Room is full.');
        return;
      }
      joinRoom(ws, room);
      return;
    }

    if (payload.type === 'start') {
      const room = clientRoom.get(ws);
      const playerId = clientPlayerId.get(ws);
      if (!room || !playerId) {
        sendError(ws, 'Join a room first.');
        return;
      }
      if (room.hostId !== playerId) {
        sendError(ws, 'Only the host can start the game.');
        return;
      }
      if (room.hasStarted) {
        sendError(ws, 'Game already started.');
        return;
      }
      if (room.players.length < 2) {
        sendError(ws, 'Need at least 2 players to start.');
        return;
      }
      room.hasStarted = true;
      room.isGameActive = true;
      room.currentPlayerIndex = 0;
      broadcastState(room);
      return;
    }

    if (payload.type === 'restart') {
      const room = clientRoom.get(ws);
      if (!room) {
        sendError(ws, 'Join a room first.');
        return;
      }
      reassignPlayerIds(room);
      room.board = createEmptyBoard();
      room.movesMade = new Set();
      room.eliminatedPlayers = new Set();
      room.winnerId = null;
      room.currentPlayerIndex = 0;
      room.hasStarted = true;
      room.isGameActive = true;
      broadcastState(room);
      return;
    }

    if (payload.type === 'destroy') {
      const room = clientRoom.get(ws);
      const playerId = clientPlayerId.get(ws);
      if (!room || !playerId) {
        sendError(ws, 'Join a room first.');
        return;
      }
      if (room.hostId !== playerId) {
        sendError(ws, 'Only the host can destroy the room.');
        return;
      }
      room.players.forEach((id) => {
        const client = clientsById.get(id);
        if (client && client.readyState === client.OPEN) {
          client.send(JSON.stringify({ type: 'roomDestroyed' }));
          client.close();
        }
        clientsById.delete(id);
      });
      rooms.delete(room.code);
      return;
    }

    if (payload.type === 'move') {
      const room = clientRoom.get(ws);
      const playerId = clientPlayerId.get(ws);
      if (!room || !playerId) {
        sendError(ws, 'Join a room first.');
        return;
      }
      if (!room.hasStarted || !room.isGameActive) {
        sendError(ws, 'Game has not started.');
        return;
      }
      const currentPlayerId = room.players[room.currentPlayerIndex];
      if (playerId !== currentPlayerId) {
        sendError(ws, 'Not your turn.');
        return;
      }
      const { row, col } = payload;
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
        sendError(ws, 'Invalid move.');
        return;
      }
      const cell = room.board[row][col];
      if (cell.owner !== null && cell.owner !== playerId) {
        sendError(ws, 'Cell is owned by another player.');
        return;
      }
      const nextBoard = cloneBoard(room.board);
      applyMove(nextBoard, row, col, playerId);
      room.board = nextBoard;
      room.movesMade.add(playerId);
      updateEliminations(room);
      const winnerId = checkForWinner(room.board, room.players, room.movesMade);
      if (winnerId) {
        room.isGameActive = false;
        room.winnerId = winnerId;
      } else {
        room.currentPlayerIndex = getNextPlayerIndex(room, room.currentPlayerIndex);
      }
      broadcastState(room);
      return;
    }

    sendError(ws, 'Unknown message type.');
  });

  ws.on('close', () => {
    const room = clientRoom.get(ws);
    const playerId = clientPlayerId.get(ws);
    if (!room || !playerId) {
      return;
    }
    room.players = room.players.filter((id) => id !== playerId);
    room.movesMade.delete(playerId);
    room.eliminatedPlayers.delete(playerId);
    clientsById.delete(playerId);
    clientRoom.delete(ws);
    clientPlayerId.delete(ws);

    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }

    if (room.hostId === playerId) {
      room.hostId = room.players[0] ?? null;
    }
    if (room.currentPlayerIndex >= room.players.length) {
      room.currentPlayerIndex = 0;
    }
    room.currentPlayerIndex = getNextPlayerIndex(room, room.currentPlayerIndex - 1);
    broadcastState(room);
  });
});

const joinRoom = (ws, room) => {
  const playerId = room.nextPlayerId;
  room.nextPlayerId += 1;
  room.players.push(playerId);
  if (!room.hostId) {
    room.hostId = playerId;
  }
  clientsById.set(playerId, ws);
  clientRoom.set(ws, room);
  clientPlayerId.set(ws, playerId);
  ws.send(
    JSON.stringify({
      type: 'joined',
      playerId,
      roomCode: room.code,
    }),
  );
  broadcastState(room);
};

console.log(`WebSocket server running`);

