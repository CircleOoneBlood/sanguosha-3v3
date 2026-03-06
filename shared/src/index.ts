export type Team = "A" | "B";

export interface PlayerSnapshot {
  id: string;
  name: string;
  seat: number;
  team: Team;
  hp: number;
  handCount: number;
  isAlive: boolean;
}

export interface RoomSnapshot {
  id: string;
  status: "lobby" | "playing" | "ended";
  players: PlayerSnapshot[];
  turnPlayerId?: string;
  round: number;
  log: string[];
}

export type ClientMessage =
  | { type: "join_room"; roomId: string; name: string }
  | { type: "create_room"; name: string }
  | { type: "start_game" }
  | { type: "end_turn" }
  | { type: "ping" };

export type ServerMessage =
  | { type: "error"; message: string }
  | { type: "joined"; roomId: string; playerId: string }
  | { type: "room_update"; room: RoomSnapshot }
  | { type: "pong" };
