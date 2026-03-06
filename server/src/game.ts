import { nanoid } from "nanoid";
import type { CardKind, PendingAction, PlayerSnapshot, RoomSnapshot, Team } from "../../shared/src/index";

interface PlayerState extends PlayerSnapshot {
  socketId?: string;
}

interface RoomState {
  id: string;
  status: "lobby" | "playing" | "ended";
  players: PlayerState[];
  turnPlayerId?: string;
  round: number;
  phase?: "draw" | "play" | "discard";
  slashUsedInTurn: number;
  pendingAction?: PendingAction;
  winnerTeam?: Team;
  drawPile: CardKind[];
  discardPile: CardKind[];
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
      slashUsedInTurn: 0,
      drawPile: [],
      discardPile: [],
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

  addBots(roomId: string, actorPlayerId: string, count = 5) {
    const room = this.mustGetRoom(roomId);
    if (room.status !== "lobby") throw new Error("仅可在房间阶段添加机器人");

    const allowDevBypass = process.env.ALLOW_DEV_BYPASS === "1";
    if (!allowDevBypass) throw new Error("未开启开发测试后门");

    const actor = room.players.find((p) => p.id === actorPlayerId);
    if (!actor || room.players[0].id !== actor.id) throw new Error("只有房主可添加机器人");

    const free = 6 - room.players.length;
    const toAdd = Math.max(0, Math.min(count, free));
    for (let i = 0; i < toAdd; i++) {
      const id = nanoid(8);
      const botNo = room.players.filter((p) => p.isBot).length + 1;
      room.players.push(this.createPlayer(id, undefined, `Bot-${botNo}`, room.players.length + 1, true));
    }
    room.log.push(`已添加 ${toAdd} 个机器人（当前 ${room.players.length}/6）`);
  }

  runBotLoop(roomId: string, maxSteps = 20) {
    const room = this.mustGetRoom(roomId);
    let steps = 0;

    while (steps < maxSteps && room.status === "playing") {
      steps += 1;

      const pending = room.pendingAction;
      if (pending) {
        const target = this.mustFindPlayer(room, pending.targetPlayerId);
        if (!target.isBot) break;

        if (pending.type === "await_dodge") {
          if (target.hand.includes("dodge")) this.respondDodge(room.id, target.id);
          else this.acceptHit(room.id, target.id);
          continue;
        }
        if (pending.type === "await_peach") {
          if (target.hand.includes("peach")) this.usePeach(room.id, target.id);
          else this.acceptDeath(room.id, target.id);
          continue;
        }
        if (pending.type === "await_discard") {
          if (target.hand.length > target.hp) {
            const preferKeepPeach = target.hp <= 2;
            const discard =
              (preferKeepPeach ? target.hand.find((c) => c !== "peach") : undefined) ?? target.hand[0];
            this.discardCard(room.id, target.id, discard);
          } else {
            this.finishDiscard(room.id, target.id);
          }
          continue;
        }
      }

      const turn = room.turnPlayerId ? this.mustFindPlayer(room, room.turnPlayerId) : undefined;
      if (!turn || !turn.isBot) break;

      const enemies = room.players.filter((p) => p.isAlive && p.team !== turn.team);
      const inRange = enemies
        .filter((e) => this.seatDistance(turn.seat, e.seat, room.players.length) <= 1)
        .sort((a, b) => a.hp - b.hp || a.handCount - b.handCount);

      const canAggro = turn.hand.includes("slash") && room.slashUsedInTurn < 1;

      if (room.phase === "play" && turn.hp <= 2 && turn.hand.includes("peach")) {
        this.playPeachSelf(room.id, turn.id);
      } else if (room.phase === "play" && canAggro && inRange[0]) {
        this.playSlash(room.id, turn.id, inRange[0].id);
      } else if (room.phase === "play") {
        this.endTurn(room.id, turn.id);
      } else {
        break;
      }
    }
  }

  startGame(roomId: string, actorPlayerId: string, options?: { devBypass?: boolean }) {
    const room = this.mustGetRoom(roomId);
    if (room.status !== "lobby") throw new Error("游戏状态错误");

    const allowDevBypass = process.env.ALLOW_DEV_BYPASS === "1";
    const useBypass = options?.devBypass === true && allowDevBypass;

    if (!useBypass && room.players.length !== 6) throw new Error("3v3 模式必须满 6 人才能开始");
    if (useBypass && room.players.length < 2) throw new Error("测试开局至少需要 2 人");

    const actor = room.players.find((p) => p.id === actorPlayerId);
    if (!actor || room.players[0].id !== actor.id) {
      throw new Error("只有房主可以开始");
    }

    room.drawPile = this.createDeck();
    room.discardPile = [];

    const shuffled = [...room.players].sort(() => Math.random() - 0.5);
    shuffled.forEach((player, i) => {
      const team: Team = i % 2 === 0 ? "A" : "B";
      player.team = team;
      player.hp = 4;
      player.hand = this.drawCards(room, 4);
      player.handCount = player.hand.length;
      player.isAlive = true;
    });

    room.players = shuffled.map((p, i) => ({ ...p, seat: i + 1 }));
    room.status = "playing";
    room.round = 1;
    room.turnPlayerId = room.players[0]?.id;
    room.phase = "draw";
    room.slashUsedInTurn = 0;
    room.pendingAction = undefined;
    room.winnerTeam = undefined;
    this.drawForTurn(room, room.turnPlayerId!);
    room.phase = "play";
    room.log.push(useBypass ? `游戏开始：测试模式开局（${room.players.length}人）` : "游戏开始：3v3 对战开始");
  }

  playSlash(roomId: string, actorPlayerId: string, targetPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    this.assertPlayingTurn(room, actorPlayerId);
    if (room.pendingAction) throw new Error("当前有待响应动作");
    if (room.phase !== "play") throw new Error("当前不在出牌阶段");
    if (room.slashUsedInTurn >= 1) throw new Error("每回合仅可使用一次【杀】");

    const actor = this.mustFindPlayer(room, actorPlayerId);
    const target = this.mustFindPlayer(room, targetPlayerId);

    if (!target.isAlive) throw new Error("目标已阵亡");
    if (actor.team === target.team) throw new Error("不能攻击队友");
    if (this.seatDistance(actor.seat, target.seat, room.players.length) > 1) {
      throw new Error("目标不在攻击范围内");
    }

    this.consumeCard(room, actor, "slash");
    room.slashUsedInTurn += 1;
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
    this.consumeCard(room, target, "dodge");
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
    this.consumeCard(room, target, "peach");
    target.hp = 1;
    room.pendingAction = undefined;
    room.log.push(`${target.name} 使用【桃】成功自救，回复至 1 HP`);
  }

  playPeachSelf(roomId: string, actorPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    this.assertPlayingTurn(room, actorPlayerId);
    if (room.pendingAction) throw new Error("当前有待响应动作");
    if (room.phase !== "play") throw new Error("当前不在出牌阶段");

    const actor = this.mustFindPlayer(room, actorPlayerId);
    if (actor.hp >= 4) throw new Error("体力已满，无需使用桃");
    this.consumeCard(room, actor, "peach");
    actor.hp += 1;
    room.log.push(`${actor.name} 在出牌阶段使用【桃】，回复至 ${actor.hp} HP`);
  }

  acceptDeath(roomId: string, actorPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    const pending = room.pendingAction;
    if (!pending || pending.type !== "await_peach") throw new Error("当前无需确认阵亡");
    if (pending.targetPlayerId !== actorPlayerId) throw new Error("不是你的响应时机");

    const target = this.mustFindPlayer(room, actorPlayerId);
    target.isAlive = false;
    room.discardPile.push(...target.hand);
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
    if (room.phase !== "play") throw new Error("当前不在出牌阶段");

    this.startDiscardPhase(room, actorPlayerId);
  }

  discardCard(roomId: string, actorPlayerId: string, card: CardKind) {
    const room = this.mustGetRoom(roomId);
    this.assertPlayingTurn(room, actorPlayerId);
    const pending = room.pendingAction;
    if (!pending || pending.type !== "await_discard") throw new Error("当前无需弃牌");
    if (pending.targetPlayerId !== actorPlayerId) throw new Error("不是你的弃牌时机");

    const actor = this.mustFindPlayer(room, actorPlayerId);
    this.consumeCard(room, actor, card);
    room.log.push(`${actor.name} 弃置【${this.cardLabel(card)}】`);

    if (actor.hand.length <= actor.hp) {
      room.pendingAction = undefined;
      this.advanceTurn(room, actorPlayerId);
    } else {
      room.pendingAction = {
        type: "await_discard",
        sourcePlayerId: actor.id,
        targetPlayerId: actor.id,
        message: `${actor.name} 需要继续弃牌（当前 ${actor.hand.length}/${actor.hp}）`
      };
    }
  }

  finishDiscard(roomId: string, actorPlayerId: string) {
    const room = this.mustGetRoom(roomId);
    this.assertPlayingTurn(room, actorPlayerId);
    const pending = room.pendingAction;
    if (!pending || pending.type !== "await_discard") throw new Error("当前无需完成弃牌");
    if (pending.targetPlayerId !== actorPlayerId) throw new Error("不是你的弃牌时机");

    const actor = this.mustFindPlayer(room, actorPlayerId);
    if (actor.hand.length > actor.hp) throw new Error("手牌仍超过体力上限，不能结束弃牌");

    room.pendingAction = undefined;
    this.advanceTurn(room, actorPlayerId);
  }

  getRoomSnapshot(roomId: string): RoomSnapshot {
    const room = this.mustGetRoom(roomId);
    return {
      id: room.id,
      status: room.status,
      players: room.players.map(({ socketId: _, ...rest }) => rest),
      turnPlayerId: room.turnPlayerId,
      round: room.round,
      phase: room.phase,
      slashUsedInTurn: room.slashUsedInTurn,
      pendingAction: room.pendingAction,
      winnerTeam: room.winnerTeam,
      drawPileCount: room.drawPile.length,
      discardPileCount: room.discardPile.length,
      log: room.log.slice(-40)
    };
  }

  getRoomBySocket(socketId: string): RoomState | undefined {
    return [...this.rooms.values()].find((room) => room.players.some((p) => p.socketId && p.socketId === socketId));
  }

  getPlayerBySocket(roomId: string, socketId: string): PlayerState | undefined {
    const room = this.rooms.get(roomId);
    return room?.players.find((p) => p.socketId && p.socketId === socketId);
  }

  removeSocket(socketId: string) {
    const room = this.getRoomBySocket(socketId);
    if (!room) return;
    room.log.push(`玩家掉线：${socketId.slice(0, 6)}`);
  }

  private createPlayer(id: string, socketId: string | undefined, name: string, seat: number, isBot = false): PlayerState {
    return { id, socketId, name, seat, team: "A", hp: 4, handCount: 0, hand: [], isAlive: true, isBot };
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

  private consumeCard(room: RoomState, player: PlayerState, card: CardKind) {
    const idx = player.hand.indexOf(card);
    if (idx < 0) throw new Error(`你没有【${this.cardLabel(card)}】`);
    const [discarded] = player.hand.splice(idx, 1);
    room.discardPile.push(discarded);
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
    room.discardPile.push(...target.hand);
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
      room.phase = undefined;
      room.pendingAction = undefined;
      room.log.push(`对局结束：${room.winnerTeam} 阵营获胜`);
    }
  }

  private drawForTurn(room: RoomState, playerId: string) {
    const player = this.mustFindPlayer(room, playerId);
    if (!player.isAlive) return;
    const drawn = this.drawCards(room, 2);
    player.hand.push(...drawn);
    player.handCount = player.hand.length;
    room.log.push(`${player.name} 摸牌 ${drawn.map((c) => `【${this.cardLabel(c)}】`).join(" ")}`);
  }

  private drawCards(room: RoomState, n: number): CardKind[] {
    const cards: CardKind[] = [];
    for (let i = 0; i < n; i++) {
      if (room.drawPile.length === 0) {
        if (room.discardPile.length === 0) break;
        room.drawPile = this.shuffle(room.discardPile.splice(0));
        room.log.push("牌堆耗尽，已将弃牌堆洗入摸牌堆");
      }
      const top = room.drawPile.pop();
      if (top) cards.push(top);
    }
    return cards;
  }

  private createDeck(): CardKind[] {
    const deck: CardKind[] = [];
    for (let i = 0; i < 48; i++) deck.push("slash");
    for (let i = 0; i < 28; i++) deck.push("dodge");
    for (let i = 0; i < 20; i++) deck.push("peach");
    return this.shuffle(deck);
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private startDiscardPhase(room: RoomState, actorPlayerId: string) {
    const actor = this.mustFindPlayer(room, actorPlayerId);
    room.phase = "discard";

    if (actor.hand.length <= actor.hp) {
      room.log.push(`${actor.name} 无需弃牌`);
      this.advanceTurn(room, actorPlayerId);
      return;
    }

    room.pendingAction = {
      type: "await_discard",
      sourcePlayerId: actor.id,
      targetPlayerId: actor.id,
      message: `${actor.name} 需要弃牌至 ${actor.hp} 张（当前 ${actor.hand.length}）`
    };
  }

  private advanceTurn(room: RoomState, actorPlayerId: string) {
    const alive = room.players.filter((p) => p.isAlive);
    const idx = alive.findIndex((p) => p.id === actorPlayerId);
    const next = alive[(idx + 1) % alive.length];
    const actor = this.mustFindPlayer(room, actorPlayerId);

    room.turnPlayerId = next.id;
    if (idx === alive.length - 1) room.round += 1;

    const nextPlayer = room.players.find((p) => p.id === next.id);
    room.log.push(`${actor.name} 结束回合，轮到 ${nextPlayer?.name}`);
    room.phase = "draw";
    room.slashUsedInTurn = 0;
    this.drawForTurn(room, next.id);
    room.phase = "play";
  }

  private seatDistance(a: number, b: number, total: number) {
    const d = Math.abs(a - b);
    return Math.min(d, total - d);
  }

  private cardLabel(card: CardKind) {
    if (card === "slash") return "杀";
    if (card === "dodge") return "闪";
    return "桃";
  }
}
