import { WebSocketServer, type WebSocket } from "ws";
import { GameManager } from "./game.js";
import type { ClientMessage, ServerMessage } from "../../shared/src/index";

const PORT = Number(process.env.PORT || 3001);
const wss = new WebSocketServer({ port: PORT });
const game = new GameManager();

const sockets = new Map<string, WebSocket>();
let socketSeq = 0;

function send(ws: WebSocket, message: ServerMessage) {
  ws.send(JSON.stringify(message));
}

function broadcastRoom(roomId: string) {
  const snapshot = game.getRoomSnapshot(roomId);
  for (const [socketId, ws] of sockets) {
    const room = game.getRoomBySocket(socketId);
    if (room?.id === roomId && ws.readyState === ws.OPEN) {
      send(ws, { type: "room_update", room: snapshot });
    }
  }
}

wss.on("connection", (ws) => {
  const socketId = `s_${++socketSeq}`;
  sockets.set(socketId, ws);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;

      if (msg.type === "ping") {
        return send(ws, { type: "pong" });
      }

      if (msg.type === "create_room") {
        const { roomId, playerId } = game.createRoom(msg.name, socketId);
        send(ws, { type: "joined", roomId, playerId });
        broadcastRoom(roomId);
        return;
      }

      if (msg.type === "join_room") {
        const { playerId } = game.joinRoom(msg.roomId.toUpperCase(), msg.name, socketId);
        send(ws, { type: "joined", roomId: msg.roomId.toUpperCase(), playerId });
        broadcastRoom(msg.roomId.toUpperCase());
        return;
      }

      const room = game.getRoomBySocket(socketId);
      if (!room) throw new Error("请先加入房间");
      const actor = game.getPlayerBySocket(room.id, socketId);
      if (!actor) throw new Error("玩家不存在");

      if (msg.type === "start_game") {
        game.startGame(room.id, actor.id);
      } else if (msg.type === "end_turn") {
        game.endTurn(room.id, actor.id);
      }

      broadcastRoom(room.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "服务器错误";
      send(ws, { type: "error", message });
    }
  });

  ws.on("close", () => {
    game.removeSocket(socketId);
    sockets.delete(socketId);
  });
});

console.log(`🀄 Sanguosha server running at ws://localhost:${PORT}`);
