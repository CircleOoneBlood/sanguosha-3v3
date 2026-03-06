import { nanoid } from "nanoid";
import type { PlayerSnapshot, RoomSnapshot, Team } from "../../shared/src/index";

interface PlayerState extends PlayerSnapshot {
  socketId: string;
}

interface RoomState {
  id: string;
  status: "lobby" | "playing" | "ended";
  players: PlayerState[];
  turnPlayerId?: string;
  round: number;
  log: string[];
}

export class GameManager {
  private rooms = new Map<string, RoomState>();

  createRoom(name: string, socketId: string) {
    const roomId = nanoid(6).toUpperCase();
    const playerId = nanoid(8);
    const room: RoomState = {
      id: roomId,
      status: "lobby",
      players: [this.createPlayer(playerId, socketId, name, 1)],
      round: 0,
      log: [`${name} 创建了房间`]
    };
    this.rooms.set(roomId, room);
    return { roomId, playerId };
  }

  joinRoom(roomId: string, name: string, socketId: string) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("房间不存在");
    if (room.status !== "lobby") throw new Error("游戏已开始");
    if (room.players.length >= 6) throw new Error("房间已满（3v3）");

    const playerId = nanoid(8);
    room.players.push(this.createPlayer(playerId, socketId, name, room.players.length + 1));
    room.log.push(`${name} 加入了房间`);

    return { playerId };
  }

  startGame(roomId: string, actorPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    if (room.status !== "lobby") throw new Error("游戏状态错误");
    if (room.players.length !== 6) throw new Error("3v3 模式必须满 6 人才能开始");

    const actor = room.players.find((p) => p.id === actorPlayerId);
    if (!actor || room.players[0].id !== actor.id) {
      throw new Error("只有房主可以开始");
    }

    const shuffled = [...room.players].sort(() => Math.random() - 0.5);
    shuffled.forEach((player, i) => {
      const team: Team = i % 2 === 0 ? "A" : "B";
      player.team = team;
      player.hp = 4;
      player.handCount = 4;
      player.isAlive = true;
    });

    room.players = shuffled.map((p, i) => ({ ...p, seat: i + 1 }));
    room.status = "playing";
    room.round = 1;
    room.turnPlayerId = room.players[0]?.id;
    room.log.push("游戏开始：3v3 对战开始");
  }

  endTurn(roomId: string, actorPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    if (room.status !== "playing") throw new Error("当前不在对局中");
    if (room.turnPlayerId !== actorPlayerId) throw new Error("还没轮到你");

    const alive = room.players.filter((p) => p.isAlive);
    const idx = alive.findIndex((p) => p.id === actorPlayerId);
    const next = alive[(idx + 1) % alive.length];
    room.turnPlayerId = next.id;
    if (idx === alive.length - 1) room.round += 1;

    const actor = room.players.find((p) => p.id === actorPlayerId);
    const nextPlayer = room.players.find((p) => p.id === next.id);
    room.log.push(`${actor?.name} 结束回合，轮到 ${nextPlayer?.name}`);
  }

  getRoomSnapshot(roomId: string): RoomSnapshot {
    const room = this.mustGetRoom(roomId);
    return {
      id: room.id,
      status: room.status,
      players: room.players.map(({ socketId: _, ...rest }) => rest),
      turnPlayerId: room.turnPlayerId,
      round: room.round,
      log: room.log.slice(-20)
    };
  }

  getRoomBySocket(socketId: string): RoomState | undefined {
    return [...this.rooms.values()].find((room) => room.players.some((p) => p.socketId === socketId));
  }

  getPlayerBySocket(roomId: string, socketId: string): PlayerState | undefined {
    const room = this.rooms.get(roomId);
    return room?.players.find((p) => p.socketId === socketId);
  }

  removeSocket(socketId: string) {
    const room = this.getRoomBySocket(socketId);
    if (!room) return;
    room.log.push(`玩家掉线：${socketId.slice(0, 6)}`);
  }

  private createPlayer(id: string, socketId: string, name: string, seat: number): PlayerState {
    return { id, socketId, name, seat, team: "A", hp: 4, handCount: 0, isAlive: true };
  }

  private mustGetRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("房间不存在");
    return room;
  }
}
