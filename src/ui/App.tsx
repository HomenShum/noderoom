import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Landing } from "./Landing";
import { RoomShell } from "./RoomShell";
import { EngineStoreProvider, ConvexStoreProvider, HAS_CONVEX } from "../app/store";
import type { Actor } from "../engine/types";

const LIVE_DEMO_CODE = "Q3DEMO";
const liveSessionKey = (code: string) => `noderoom:live:${code.toUpperCase()}`;

// Starter spreadsheet seeded into a freshly-created live room — matches the demo's "Q3 variance"
// shape so the existing /ask agent (which fills r_gp__variance / r_ni__variance) works unchanged.
const STARTER_SHEET_ROWS = [
  { id: "r_rev", label: "Revenue", q2: "$10,000", q3: "$12,400" },
  { id: "r_cogs", label: "COGS", q2: "$4,000", q3: "$5,100" },
  { id: "r_gp", label: "Gross profit", q2: "$6,000", q3: "$7,300" },
  { id: "r_opex", label: "OpEx", q2: "$2,200", q3: "$2,650" },
  { id: "r_ni", label: "Net income", q2: "$3,800", q3: "$4,650" },
];
function starterSheetSeed(): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  for (const r of STARTER_SHEET_ROWS) {
    seed.push({ id: `${r.id}__label`, value: r.label });
    seed.push({ id: `${r.id}__q2`, value: r.q2 });
    seed.push({ id: `${r.id}__q3`, value: r.q3 });
    seed.push({ id: `${r.id}__variance`, value: "" });
    seed.push({ id: `${r.id}__note`, value: "" });
  }
  return seed;
}

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

/* Live: connect to Convex. Default joins the seeded Q3DEMO room; `?room=CODE` joins any room;
   `?create=1` (or `?create=CODE`) creates a fresh room + a shared Q3 variance sheet; `?name=NAME` sets the display name. */
function ConvexApp() {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const createParam = params.get("create");
  const joinParam = params.get("room");
  const nameParam = params.get("name") || undefined;
  const wantCreate = createParam !== null;
  const explicit = (createParam && createParam !== "1" ? createParam : joinParam) || "";
  const code = (explicit || LIVE_DEMO_CODE).toUpperCase();

  const byCode = useQuery(api.rooms.byCode, { code });
  const join = useMutation(api.rooms.joinAnonymous);
  const createRoom = useMutation(api.rooms.create);
  const createArtifact = useMutation(api.artifacts.createArtifact);
  const [session, setSession] = useState<LiveSession | null>(() => loadLiveSession(liveSessionKey(code)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session || busy || byCode === undefined) return;
    setBusy(true);
    const token = randomToken();
    const name = nameParam || `Guest ${token.slice(0, 4)}`;
    void (async () => {
      let joined: { roomId: string; memberId: string } | null = null;
      if (byCode) {
        const r = await join({ code, name, authToken: token, anon: !wantCreate });
        joined = r ? { roomId: String(r.roomId), memberId: String(r.memberId) } : null;
      } else if (wantCreate) {
        try {
          const r = await createRoom({ code, title: "Team Q3 Review", hostName: name, authToken: token, autoAllow: true });
          joined = { roomId: String(r.roomId), memberId: String(r.memberId) };
          const proof = { actor: { kind: "user" as const, id: joined.memberId, name }, token };
          await createArtifact({ roomId: r.roomId, kind: "sheet", title: "Q3 variance", seed: starterSheetSeed(), proof });
        } catch {
          const r = await join({ code, name, authToken: token });
          joined = r ? { roomId: String(r.roomId), memberId: String(r.memberId) } : null;
        }
      }
      if (!joined) { setError(`Room "${code}" not found — create it with ?create=${code}`); setBusy(false); return; }
      const next = { roomId: joined.roomId, memberId: joined.memberId, name, token };
      try { localStorage.setItem(liveSessionKey(code), JSON.stringify(next)); } catch { /* ignore */ }
      setSession(next);
      setBusy(false);
    })().catch((e) => { setError(e instanceof Error ? e.message : String(e)); setBusy(false); });
  }, [byCode, session, busy, code, wantCreate, nameParam, join, createRoom, createArtifact]);

  if (error) return <Splash text={error} />;
  if (!session) return <Splash text={byCode === undefined ? `Connecting to ${code}…` : wantCreate ? `Creating ${code}…` : `Joining ${code}…`} />;

  const me: Actor = { kind: "user", id: session.memberId, name: session.name };
  const proof = { actor: me, token: session.token };
  return (
    <ConvexStoreProvider roomId={session.roomId} me={me} proof={proof}>
      <RoomShell roomId={session.roomId} me={me} onLeave={() => undefined} />
    </ConvexStoreProvider>
  );
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function loadLiveSession(key: string): LiveSession | null {
  try {
    const raw = localStorage.getItem(key);
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
