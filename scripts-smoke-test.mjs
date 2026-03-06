import WebSocket from 'ws';

const URL = 'ws://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mkClient(name) {
  const ws = new WebSocket(URL);
  const state = { name, ws, roomId: null, playerId: null, room: null, errors: [] };
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'joined') {
      state.roomId = msg.roomId;
      state.playerId = msg.playerId;
    }
    if (msg.type === 'room_update') state.room = msg.room;
    if (msg.type === 'error') state.errors.push(msg.message);
  });
  return state;
}

function send(c, payload) { c.ws.send(JSON.stringify(payload)); }

async function waitOpen(clients) {
  await Promise.all(clients.map(c => new Promise((res, rej) => {
    c.ws.on('open', res);
    c.ws.on('error', rej);
  })));
}

async function waitFor(predicate, label, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`Timeout: ${label}`);
}

async function main() {
  const clients = Array.from({ length: 6 }, (_, i) => mkClient(`P${i + 1}`));
  try {
    await waitOpen(clients);

    send(clients[0], { type: 'create_room', name: clients[0].name });
    await waitFor(() => !!clients[0].roomId, 'creator joined');
    const roomId = clients[0].roomId;

    for (let i = 1; i < clients.length; i++) {
      send(clients[i], { type: 'join_room', roomId, name: clients[i].name });
    }

    await waitFor(() => clients.every(c => c.roomId === roomId), 'all joined');
    send(clients[0], { type: 'start_game' });

    await waitFor(() => clients.some(c => c.room?.status === 'playing'), 'game started');

    // Wait for first turn snapshot
    await sleep(200);
    const room = clients.find(c => c.room)?.room;
    if (!room) throw new Error('No room snapshot');

    const turnId = room.turnPlayerId;
    const turnClient = clients.find(c => c.playerId === turnId);
    if (!turnClient) throw new Error('No current turn client');

    const me = room.players.find(p => p.id === turnId);
    const enemy = room.players.find(p => p.team !== me.team && p.isAlive);
    if (!enemy) throw new Error('No enemy found');

    // Try play slash; if no slash in hand, end turn.
    if (me.hand.includes('slash')) {
      send(turnClient, { type: 'play_slash', targetPlayerId: enemy.id });
      await sleep(200);
      const latest = turnClient.room;
      if (latest?.pendingAction?.type === 'await_dodge') {
        const targetClient = clients.find(c => c.playerId === enemy.id);
        const target = latest.players.find(p => p.id === enemy.id);
        if (target.hand.includes('dodge')) send(targetClient, { type: 'respond_dodge' });
        else send(targetClient, { type: 'accept_hit' });
      }
    }

    await sleep(300);
    send(turnClient, { type: 'end_turn' });

    await sleep(300);
    const post = clients[0].room;
    const result = {
      ok: true,
      roomId,
      status: post?.status,
      round: post?.round,
      phase: post?.phase,
      turnPlayerId: post?.turnPlayerId,
      pendingAction: post?.pendingAction?.type ?? null,
      errors: clients.flatMap(c => c.errors).slice(0, 5),
      logTail: (post?.log ?? []).slice(-6)
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    clients.forEach(c => c.ws.close());
  }
}

main().catch((e) => {
  console.error('SMOKE_FAIL', e.message);
  process.exit(1);
});
