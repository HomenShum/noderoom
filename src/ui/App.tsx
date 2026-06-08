import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Landing } from "./Landing";
import { RoomShell } from "./RoomShell";
import { EngineStoreProvider, ConvexStoreProvider, HAS_CONVEX } from "../app/store";
import type { Actor } from "../engine/types";

const LIVE_DEMO_CODE = "Q3DEMO";
const LIVE_SESSION_KEY = "noderoom:live:Q3DEMO";

export interface Session {
  roomId: string;
  me: Actor;
}

interface LiveSession {
  roomId: string;
  memberId: string;
  name: string;
  token: string;
}

export function App() {
  return HAS_CONVEX ? <ConvexApp /> : <MemoryApp />;
}

/* No keys: the deterministic in-memory engine + the landing. */
function MemoryApp() {
  const [session, setSession] = useState<Session | null>(null);
  if (!session) return <Landing onEnter={setSession} />;
  return (
    <EngineStoreProvider roomId={session.roomId} me={session.me}>
      <RoomShell roomId={session.roomId} me={session.me} onLeave={() => setSession(null)} />
    </EngineStoreProvider>
  );
}

/* Live: connect to Convex and join the seeded Q3 room with a local member token. */
function ConvexApp() {
  const demoRoom = useQuery(api.rooms.byCode, { code: LIVE_DEMO_CODE });
  const join = useMutation(api.rooms.joinAnonymous);
  const [session, setSession] = useState<LiveSession | null>(() => loadLiveSession());
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!demoRoom || session || joining) return;
    const token = randomToken();
    const name = `Guest ${token.slice(0, 4)}`;
    setJoining(true);
    void join({ code: LIVE_DEMO_CODE, name, authToken: token }).then((joined) => {
      if (!joined) {
        setError("Could not join the live room.");
        return;
      }
      const next = { roomId: String(joined.roomId), memberId: String(joined.memberId), name, token };
      localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify(next));
      setSession(next);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setJoining(false));
  }, [demoRoom, join, joining, session]);

  if (demoRoom === undefined) return <Splash text="Connecting to Convex..." />;
  if (demoRoom === null) return <Splash text="No live room yet. Run the seed command from README." />;
  if (error) return <Splash text={error} />;
  if (!session || session.roomId !== String(demoRoom.roomId)) return <Splash text="Joining live room..." />;

  const me: Actor = { kind: "user", id: session.memberId, name: session.name };
  const proof = { actor: me, token: session.token };
  return (
    <ConvexStoreProvider roomId={demoRoom.roomId} me={me} proof={proof}>
      <RoomShell roomId={demoRoom.roomId} me={me} onLeave={() => undefined} />
    </ConvexStoreProvider>
  );
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function loadLiveSession(): LiveSession | null {
  try {
    const raw = localStorage.getItem(LIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LiveSession>;
    return parsed.roomId && parsed.memberId && parsed.name && parsed.token
      ? { roomId: parsed.roomId, memberId: parsed.memberId, name: parsed.name, token: parsed.token }
      : null;
  } catch {
    return null;
  }
}

function Splash({ text }: { text: string }) {
  return <div className="r-app"><div className="r-screen"><div style={{ margin: "auto" }} className="muted">{text}</div></div></div>;
}
