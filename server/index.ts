import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const GRID_WIDTH = 20;
const GRID_HEIGHT = 20;
const TICK_RATE_MS = 100;

interface Player {
  id: string;
  x: number;
  y: number;
  color: string;
}

const players = new Map<string, Player>();
const sockets = new Map<string, WebSocket>();

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c'];
let nextId = 1;

function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

const httpServer = createServer(async (req, res) => {
  const url = req.url === '/' ? '/index.html' : (req.url ?? '/index.html');
  const filePath = join(PUBLIC_DIR, url);
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

const MOVE_DELTAS: Record<string, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

wss.on('connection', (socket) => {
  const id = `p${nextId++}`;
  const player: Player = {
    id,
    x: Math.floor(GRID_WIDTH / 2),
    y: Math.floor(GRID_HEIGHT / 2),
    color: randomColor(),
  };
  players.set(id, player);
  sockets.set(id, socket);

  socket.send(JSON.stringify({ type: 'init', id, gridWidth: GRID_WIDTH, gridHeight: GRID_HEIGHT }));

  socket.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'move') {
      const p = players.get(id);
      const delta = MOVE_DELTAS[msg.dir];
      if (!p || !delta) return;
      p.x = Math.min(GRID_WIDTH - 1, Math.max(0, p.x + delta[0]));
      p.y = Math.min(GRID_HEIGHT - 1, Math.max(0, p.y + delta[1]));
    }
  });

  socket.on('close', () => {
    players.delete(id);
    sockets.delete(id);
  });
});

setInterval(() => {
  const payload = JSON.stringify({ type: 'state', players: Array.from(players.values()) });
  for (const socket of sockets.values()) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}, TICK_RATE_MS);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
httpServer.listen(PORT, () => {
  console.log(`Dungeon crawler server listening on http://localhost:${PORT}`);
});
