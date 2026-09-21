const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let myId = null;
let gridWidth = 20;
let gridHeight = 20;
let players = [];

const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${location.host}/ws`);

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'init') {
    myId = msg.id;
    gridWidth = msg.gridWidth;
    gridHeight = msg.gridHeight;
  } else if (msg.type === 'state') {
    players = msg.players;
    draw();
  }
});

const KEY_TO_DIR = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

window.addEventListener('keydown', (e) => {
  const dir = KEY_TO_DIR[e.code];
  if (!dir) return;
  e.preventDefault();
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'move', dir }));
  }
});

function draw() {
  const cellW = canvas.width / gridWidth;
  const cellH = canvas.height / gridHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#333';
  for (let x = 0; x <= gridWidth; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cellW, 0);
    ctx.lineTo(x * cellW, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= gridHeight; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellH);
    ctx.lineTo(canvas.width, y * cellH);
    ctx.stroke();
  }

  for (const p of players) {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x * cellW + 2, p.y * cellH + 2, cellW - 4, cellH - 4);
    if (p.id === myId) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x * cellW + 2, p.y * cellH + 2, cellW - 4, cellH - 4);
    }
  }
}
