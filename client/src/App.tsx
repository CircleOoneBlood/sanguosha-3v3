import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, RoomSnapshot, ServerMessage } from "../../shared/src/index";

const WS_URL = "ws://localhost:3001";

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

          <div className="row">
            <button onClick={() => send({ type: "start_game" })}>开始游戏（房主）</button>
            <button disabled={room.turnPlayerId !== playerId} onClick={() => send({ type: "end_turn" })}>
              结束我的回合
            </button>
          </div>

          <h3>玩家列表</h3>
          <ul>
            {room.players.map((p) => (
              <li key={p.id}>
                [{p.seat}] {p.name} | 阵营 {p.team} | HP {p.hp} | 手牌 {p.handCount}
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
