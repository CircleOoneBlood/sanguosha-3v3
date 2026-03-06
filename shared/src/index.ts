export type Team = "A" | "B";
export type CardKind = "slash" | "dodge" | "peach";

export interface PendingAction {
  type: "await_dodge" | "await_peach";
  sourcePlayerId: string;
  targetPlayerId: string;
  message: string;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  seat: number;
  team: Team;
  hp: number;
  handCount: number;
  hand: CardKind[];
  isAlive: boolean;
}

export interface RoomSnapshot {
  id: string;
  status: "lobby" | "playing" | "ended";
  players: PlayerSnapshot[];
  turnPlayerId?: string;
  round: number;
  phase?: "draw" | "play" | "discard";
  slashUsedInTurn?: number;
  pendingAction?: PendingAction;
  winnerTeam?: Team;
  drawPileCount?: number;
  discardPileCount?: number;
  log: string[];
}

export type ClientMessage =
  | { type: "join_room"; roomId: string; name: string }
  | { type: "create_room"; name: string }
  | { type: "start_game" }
  | { type: "end_turn" }
  | { type: "play_slash"; targetPlayerId: string }
  | { type: "respond_dodge" }
  | { type: "accept_hit" }
  | { type: "use_peach" }
  | { type: "accept_death" }
  | { type: "ping" };

export type ServerMessage =
  | { type: "error"; message: string }
  | { type: "joined"; roomId: string; playerId: string }
  | { type: "room_update"; room: RoomSnapshot }
  | { type: "pong" };
