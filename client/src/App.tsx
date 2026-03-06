import { useEffect, useMemo, useRef, useState } from "react";
import type { CardKind, ClientMessage, RoomSnapshot, ServerMessage } from "../../shared/src/index";

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ||
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:3001`;

const cardLabel: Record<CardKind, string> = {
  slash: "杀",
  dodge: "闪",
  peach: "桃"
};

export function App() {
  const [wsReady, setWsReady] = useState(false);
  const [name, setName] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setWsReady(true);
    ws.onclose = () => setWsReady(false);
    ws.onerror = () => setError("WebSocket 连接失败");

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      if (msg.type === "error") setError(msg.message);
      if (msg.type === "joined") {
        setRoomId(msg.roomId);
        setPlayerId(msg.playerId);
        setError(null);
      }
      if (msg.type === "room_update") setRoom(msg.room);
    };

    return () => ws.close();
  }, []);

  const canOperate = useMemo(() => wsReady && !!name.trim(), [wsReady, name]);
  const me = room?.players.find((p) => p.id === playerId);
  const isMyTurn = room?.turnPlayerId === playerId;
  const canStart = room?.status === "lobby";

  function send(msg: ClientMessage) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(msg));
  }

  return (
    <main>
      <h1>三国杀 3v3（Web MVP）</h1>
      <p className="status">连接状态：{wsReady ? "已连接" : "未连接"}</p>

      <section className="card">
        <label>
          你的昵称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：Will" />
        </label>
        <div className="row">
          <button disabled={!canOperate} onClick={() => send({ type: "create_room", name: name.trim() })}>
            创建房间
          </button>
          <input
            value={roomIdInput}
            onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
            placeholder="输入房间号"
          />
          <button
            disabled={!canOperate || !roomIdInput}
            onClick={() => send({ type: "join_room", roomId: roomIdInput.trim(), name: name.trim() })}
          >
            加入房间
          </button>
        </div>
      </section>

      {roomId && <p>当前房间：{roomId}</p>}
      {error && <p className="error">错误：{error}</p>}

      {room && (
        <section className="card">
          <h2>对局状态：{room.status}</h2>
          <p>回合轮次：{room.round}</p>
          <p>当前行动玩家：{room.turnPlayerId ?? "未开始"}</p>
          <p>当前阶段：{room.phase ?? "-"} ｜ 本回合已出杀：{room.slashUsedInTurn ?? 0}</p>
          <p>牌堆：{room.drawPileCount ?? 0} ｜ 弃牌堆：{room.discardPileCount ?? 0}</p>
          {room.winnerTeam && <p>🏆 胜方阵营：{room.winnerTeam}</p>}
          {room.pendingAction && <p>⏳ 待响应：{room.pendingAction.message}</p>}

          <div className="row">
            <button disabled={!canStart} onClick={() => send({ type: "start_game" })}>
              开始游戏（房主）
            </button>
            <button disabled={!isMyTurn || !!room.pendingAction || room.status !== "playing" || room.phase !== "play"} onClick={() => send({ type: "end_turn" })}>
              结束我的回合
            </button>
          </div>

          {me && (
            <section className="card">
              <h3>我的信息</h3>
              <p>
                你是 [{me.seat}] {me.name} | 阵营 {me.team} | HP {me.hp}
              </p>
              <p>手牌：{me.hand.map((c, i) => <span key={`${c}-${i}`} className="tag">{cardLabel[c]}</span>)}</p>

              <h4>出杀目标</h4>
              <div className="row">
                {room.players
                  .filter((p) => p.id !== me.id && p.isAlive && p.team !== me.team)
                  .map((enemy) => (
                    <button
                      key={enemy.id}
                      disabled={!isMyTurn || !!room.pendingAction || room.status !== "playing" || room.phase !== "play"}
                      onClick={() => send({ type: "play_slash", targetPlayerId: enemy.id })}
                    >
                      杀 {enemy.name}
                    </button>
                  ))}
              </div>

              {room.pendingAction?.targetPlayerId === me.id && room.pendingAction.type === "await_dodge" && (
                <div className="row">
                  <button onClick={() => send({ type: "respond_dodge" })}>打出闪</button>
                  <button onClick={() => send({ type: "accept_hit" })}>不闪（吃伤害）</button>
                </div>
              )}

              {room.pendingAction?.targetPlayerId === me.id && room.pendingAction.type === "await_peach" && (
                <div className="row">
                  <button onClick={() => send({ type: "use_peach" })}>打出桃自救</button>
                  <button onClick={() => send({ type: "accept_death" })}>放弃自救</button>
                </div>
              )}

              {room.pendingAction?.targetPlayerId === me.id && room.pendingAction.type === "await_discard" && (
                <div>
                  <h4>弃牌阶段</h4>
                  <div className="row">
                    {(["slash", "dodge", "peach"] as CardKind[]).map((c) => (
                      <button key={c} onClick={() => send({ type: "discard_card", card: c })}>
                        弃 {cardLabel[c]}
                      </button>
                    ))}
                    <button onClick={() => send({ type: "finish_discard" })}>完成弃牌</button>
                  </div>
                </div>
              )}
            </section>
          )}

          <h3>玩家列表</h3>
          <ul>
            {room.players.map((p) => (
              <li key={p.id}>
                [{p.seat}] {p.name} | 阵营 {p.team} | HP {p.hp} | 手牌 {p.handCount} | {p.isAlive ? "存活" : "阵亡"}
                {room.turnPlayerId === p.id ? " ← 当前回合" : ""}
              </li>
            ))}
          </ul>

          <h3>对局日志</h3>
          <pre>{room.log.join("\n")}</pre>
        </section>
      )}
    </main>
  );
}
