import { nanoid } from "nanoid";
import type { CardKind, PendingAction, PlayerSnapshot, RoomSnapshot, Team } from "../../shared/src/index";

interface PlayerState extends PlayerSnapshot {
  socketId: string;
}

interface RoomState {
  id: string;
  status: "lobby" | "playing" | "ended";
  players: PlayerState[];
  turnPlayerId?: string;
  round: number;
  pendingAction?: PendingAction;
  winnerTeam?: Team;
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
      player.hand = this.drawCards(4);
      player.handCount = player.hand.length;
      player.isAlive = true;
    });

    room.players = shuffled.map((p, i) => ({ ...p, seat: i + 1 }));
    room.status = "playing";
    room.round = 1;
    room.turnPlayerId = room.players[0]?.id;
    room.pendingAction = undefined;
    room.winnerTeam = undefined;
    this.drawForTurn(room, room.turnPlayerId!);
    room.log.push("游戏开始：3v3 对战开始");
  }

  playSlash(roomId: string, actorPlayerId: string, targetPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    this.assertPlayingTurn(room, actorPlayerId);
    if (room.pendingAction) throw new Error("当前有待响应动作");

    const actor = this.mustFindPlayer(room, actorPlayerId);
    const target = this.mustFindPlayer(room, targetPlayerId);

    if (!target.isAlive) throw new Error("目标已阵亡");
    if (actor.team === target.team) throw new Error("不能攻击队友");
    this.consumeCard(actor, "slash");
    room.log.push(`${actor.name} 对 ${target.name} 使用【杀】`);

    if (target.hand.includes("dodge")) {
      room.pendingAction = {
        type: "await_dodge",
        sourcePlayerId: actor.id,
        targetPlayerId: target.id,
        message: `${target.name} 请选择打出【闪】或吃伤害`
      };
      return;
    }

    this.applySlashDamage(room, actor.id, target.id);
  }

  respondDodge(roomId: string, actorPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    const pending = room.pendingAction;
    if (!pending || pending.type !== "await_dodge") throw new Error("当前无需打闪");
    if (pending.targetPlayerId !== actorPlayerId) throw new Error("不是你的响应时机");

    const target = this.mustFindPlayer(room, actorPlayerId);
    this.consumeCard(target, "dodge");
    room.log.push(`${target.name} 打出【闪】，抵消了【杀】`);
    room.pendingAction = undefined;
  }

  acceptHit(roomId: string, actorPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    const pending = room.pendingAction;
    if (!pending || pending.type !== "await_dodge") throw new Error("当前无需吃伤害");
    if (pending.targetPlayerId !== actorPlayerId) throw new Error("不是你的响应时机");

    this.applySlashDamage(room, pending.sourcePlayerId, pending.targetPlayerId);
  }

  usePeach(roomId: string, actorPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    const pending = room.pendingAction;
    if (!pending || pending.type !== "await_peach") throw new Error("当前无需救援");
    if (pending.targetPlayerId !== actorPlayerId) throw new Error("不是你的响应时机");

    const target = this.mustFindPlayer(room, actorPlayerId);
    this.consumeCard(target, "peach");
    target.hp = 1;
    room.pendingAction = undefined;
    room.log.push(`${target.name} 使用【桃】成功自救，回复至 1 HP`);
  }

  acceptDeath(roomId: string, actorPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    const pending = room.pendingAction;
    if (!pending || pending.type !== "await_peach") throw new Error("当前无需确认阵亡");
    if (pending.targetPlayerId !== actorPlayerId) throw new Error("不是你的响应时机");

    const target = this.mustFindPlayer(room, actorPlayerId);
    target.isAlive = false;
    target.hand = [];
    target.handCount = 0;
    room.pendingAction = undefined;
    room.log.push(`${target.name} 阵亡`);
    this.resolveWinner(room);
  }

  endTurn(roomId: string, actorPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    this.assertPlayingTurn(room, actorPlayerId);
    if (room.pendingAction) throw new Error("当前有待响应动作");

    const alive = room.players.filter((p) => p.isAlive);
    const idx = alive.findIndex((p) => p.id === actorPlayerId);
    const next = alive[(idx + 1) % alive.length];
    room.turnPlayerId = next.id;
    if (idx === alive.length - 1) room.round += 1;

    const actor = room.players.find((p) => p.id === actorPlayerId);
    const nextPlayer = room.players.find((p) => p.id === next.id);
    room.log.push(`${actor?.name} 结束回合，轮到 ${nextPlayer?.name}`);
    this.drawForTurn(room, next.id);
  }

  getRoomSnapshot(roomId: string): RoomSnapshot {
    const room = this.mustGetRoom(roomId);
    return {
      id: room.id,
      status: room.status,
      players: room.players.map(({ socketId: _, ...rest }) => rest),
      turnPlayerId: room.turnPlayerId,
      round: room.round,
      pendingAction: room.pendingAction,
      winnerTeam: room.winnerTeam,
      log: room.log.slice(-30)
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
    return { id, socketId, name, seat, team: "A", hp: 4, handCount: 0, hand: [], isAlive: true };
  }

  private mustGetRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("房间不存在");
    return room;
  }

  private mustFindPlayer(room: RoomState, playerId: string) {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error("玩家不存在");
    return player;
  }

  private assertPlayingTurn(room: RoomState, actorPlayerId: string) {
    if (room.status !== "playing") throw new Error("当前不在对局中");
    if (room.turnPlayerId !== actorPlayerId) throw new Error("还没轮到你");
    if (room.winnerTeam) throw new Error("对局已结束");
  }

  private consumeCard(player: PlayerState, card: CardKind) {
    const idx = player.hand.indexOf(card);
    if (idx < 0) throw new Error(`你没有【${this.cardLabel(card)}】`);
    player.hand.splice(idx, 1);
    player.handCount = player.hand.length;
  }

  private applySlashDamage(room: RoomState, sourcePlayerId: string, targetPlayerId: string) {
    const source = this.mustFindPlayer(room, sourcePlayerId);
    const target = this.mustFindPlayer(room, targetPlayerId);

    target.hp -= 1;
    room.pendingAction = undefined;
    room.log.push(`${target.name} 受到 1 点伤害（HP=${target.hp}）`);

    if (target.hp > 0) return;

    if (target.hand.includes("peach")) {
      room.pendingAction = {
        type: "await_peach",
        sourcePlayerId: source.id,
        targetPlayerId: target.id,
        message: `${target.name} 濒死，是否打出【桃】自救？`
      };
      return;
    }

    target.isAlive = false;
    target.hand = [];
    target.handCount = 0;
    room.log.push(`${target.name} 阵亡`);
    this.resolveWinner(room);
  }

  private resolveWinner(room: RoomState) {
    const aliveA = room.players.filter((p) => p.isAlive && p.team === "A").length;
    const aliveB = room.players.filter((p) => p.isAlive && p.team === "B").length;

    if (aliveA === 0 || aliveB === 0) {
      room.status = "ended";
      room.winnerTeam = aliveA > 0 ? "A" : "B";
      room.turnPlayerId = undefined;
      room.pendingAction = undefined;
      room.log.push(`对局结束：${room.winnerTeam} 阵营获胜`);
    }
  }

  private drawForTurn(room: RoomState, playerId: string) {
    const player = this.mustFindPlayer(room, playerId);
    if (!player.isAlive) return;
    const drawn = this.drawCards(2);
    player.hand.push(...drawn);
    player.handCount = player.hand.length;
    room.log.push(`${player.name} 摸牌 ${drawn.map((c) => `【${this.cardLabel(c)}】`).join(" ")}`);
  }

  private drawCards(n: number): CardKind[] {
    const cards: CardKind[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      if (r < 0.5) cards.push("slash");
      else if (r < 0.8) cards.push("dodge");
      else cards.push("peach");
    }
    return cards;
  }

  private cardLabel(card: CardKind) {
    if (card === "slash") return "杀";
    if (card === "dodge") return "闪";
    return "桃";
  }
}
