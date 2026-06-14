import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Landing } from "./Landing";
import { RoomShell } from "./RoomShell";
import { LandingStory } from "../landing/LandingStory";
import { EngineStoreProvider, ConvexStoreProvider, HAS_CONVEX } from "../app/store";
import type { Actor } from "../engine/types";

const LIVE_DEMO_CODE = "Q3DEMO";
const liveSessionKey = (code: string) => `noderoom:live:${code.toUpperCase()}`;

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

function starterNoteSeed(): Array<{ id: string; value: unknown }> {
  return [{ id: "doc", value: "<h1>Team notes</h1><p>Shared notes for the Q3 review. Type here, or ask your NodeAgent to draft and update this note.</p>" }];
}

function starterWallSeed(): Array<{ id: string; value: unknown }> {
  return [
    { id: "s_welcome", value: { text: "Drop ideas here - drag to rearrange.", x: 64, y: 64, color: "#FDE68A" } },
    { id: "s_agent", value: { text: "Ask an agent to add post-its in the Room lane.", x: 280, y: 150, color: "#BBF7D0" } },
  ];
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

type LiveRequest =
  | { kind: "idle" }
  | { kind: "join" | "create"; code: string; name: string };

export function App() {
  const [hash, setHash] = useState(() => (typeof window !== "undefined" ? window.location.hash : ""));
  const [memorySession, setMemorySession] = useState<Session | null>(null);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (hash === "#story" || hash === "#/story") {
    const exit = () => { window.location.hash = ""; };
    const enter = (session: Session) => {
      if (HAS_CONVEX) {
        const url = new URL(window.location.href);
        url.hash = "";
        url.search = "";
        url.searchParams.set("room", LIVE_DEMO_CODE);
        window.history.pushState(null, "", url);
        setHash("");
        return;
      }
      setMemorySession(session);
      window.location.hash = "";
    };
    return <LandingStory onEnter={enter} onBack={exit} />;
  }

  return HAS_CONVEX ? <ConvexApp /> : <MemoryApp session={memorySession} onSession={setMemorySession} />;
}

function MemoryApp({ session, onSession }: { session: Session | null; onSession: (session: Session | null) => void }) {
  if (!session) return <Landing onEnter={onSession} />;
  return (
    <EngineStoreProvider roomId={session.roomId} me={session.me}>
      <RoomShell roomId={session.roomId} me={session.me} onLeave={() => onSession(null)} />
    </EngineStoreProvider>
  );
}

function ConvexApp() {
  const [request, setRequest] = useState<LiveRequest>(() => initialLiveRequest());
  const code = request.kind === "idle" ? "" : request.code;
  const byCode = useQuery(api.rooms.byCode, code ? { code } : "skip");
  const join = useMutation(api.rooms.joinAnonymous);
  const createRoom = useMutation(api.rooms.create);
  const leaveRoom = useMutation(api.rooms.leave);
  const createArtifact = useMutation(api.artifacts.createArtifact);
  const [session, setSession] = useState<LiveSession | null>(() => {
    const initial = initialLiveRequest();
    return initial.kind === "join" ? loadLiveSession(liveSessionKey(initial.code)) : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = (kind: "join" | "create", rawCode: string, rawName: string) => {
    const normalizedCode = normalizeLiveRoomCode(rawCode);
    if (!normalizedCode) {
      setError("Enter a 6-12 character room code.");
      return;
    }
    const name = cleanLiveName(rawName, kind === "create" ? "Host" : "Guest");
    setError(null);
    setSession(kind === "join" ? loadLiveSession(liveSessionKey(normalizedCode)) : null);
    setRequest({ kind, code: normalizedCode, name });
    writeLiveUrl(kind, normalizedCode, name);
  };

  useEffect(() => {
    if (request.kind === "idle" || session || busy || byCode === undefined) return;
    setBusy(true);
    const token = randomToken();
    const name = request.name;
    void (async () => {
      let joined: { roomId: string; memberId: string } | null = null;
      if (byCode && request.kind === "create") {
        throw new Error(`Room ${request.code} already exists. Join it instead.`);
      }
      if (byCode) {
        const result = await join({ code: request.code, name, authToken: token, anon: request.kind !== "create" });
        if (isJoinFailure(result)) throw new Error(joinFailureMessage(result.error));
        joined = result ? { roomId: String(result.roomId), memberId: String(result.memberId) } : null;
      } else if (request.kind === "create") {
        const result = await createRoom({
          code: request.code,
          title: "Team Q3 Review",
          hostName: name,
          authToken: token,
          autoAllow: true,
        });
        joined = { roomId: String(result.roomId), memberId: String(result.memberId) };
        const proof = { actor: { kind: "user" as const, id: joined.memberId, name }, token };
        await createArtifact({ roomId: result.roomId, kind: "sheet", title: "Q3 variance", seed: starterSheetSeed(), proof });
        await createArtifact({ roomId: result.roomId, kind: "note", title: "Team notes", seed: starterNoteSeed(), proof });
        await createArtifact({ roomId: result.roomId, kind: "wall", title: "Ideas wall", seed: starterWallSeed(), proof });
      }
      if (!joined) throw new Error(`Room ${request.code} was not found. Create it or check the code.`);
      const next = { roomId: joined.roomId, memberId: joined.memberId, name, token };
      try { localStorage.setItem(liveSessionKey(request.code), JSON.stringify(next)); } catch { /* ignore */ }
      setSession(next);
    })()
      .catch((e) => { setError(friendlyLiveError(e)); })
      .finally(() => { setBusy(false); });
  }, [byCode, busy, createArtifact, createRoom, join, request, session]);

  if (request.kind === "idle" || !session) {
    return (
      <Landing
        mode="live"
        defaultCode={code || LIVE_DEMO_CODE}
        busy={busy}
        joinError={error}
        onLiveDemo={(name) => start("join", LIVE_DEMO_CODE, name)}
        onLiveJoin={(roomCode, name) => start("join", roomCode, name)}
        onLiveCreate={(name) => start("create", makeLiveRoomCode(), name)}
      />
    );
  }

  const me: Actor = { kind: "user", id: session.memberId, name: session.name };
  const proof = { actor: me, token: session.token };
  const leave = () => {
    void leaveRoom({ roomId: session.roomId as never, requester: proof }).catch(() => undefined);
    try { localStorage.removeItem(liveSessionKey(request.code)); } catch { /* ignore */ }
    setSession(null);
    setRequest({ kind: "idle" });
    setError(null);
    clearLiveUrl();
  };

  return (
    <ConvexStoreProvider roomId={session.roomId} me={me} proof={proof}>
      <RoomShell roomId={session.roomId} me={me} onLeave={leave} />
    </ConvexStoreProvider>
  );
}

function initialLiveRequest(): LiveRequest {
  if (typeof window === "undefined") return { kind: "idle" };
  const params = new URLSearchParams(window.location.search);
  const name = cleanLiveName(params.get("name") ?? "", "Guest");
  const createParam = params.get("create");
  const joinParam = params.get("room");
  if (createParam !== null) {
    const code = normalizeLiveRoomCode(createParam && createParam !== "1" ? createParam : makeLiveRoomCode());
    return code ? { kind: "create", code, name } : { kind: "idle" };
  }
  if (joinParam) {
    const code = normalizeLiveRoomCode(joinParam);
    return code ? { kind: "join", code, name } : { kind: "idle" };
  }
  return { kind: "idle" };
}

function writeLiveUrl(kind: "join" | "create", code: string, name: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set(kind === "create" ? "create" : "room", code);
  if (name) url.searchParams.set("name", name);
  window.history.pushState(null, "", url);
}

function clearLiveUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  window.history.pushState(null, "", url);
}

function normalizeLiveRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function cleanLiveName(raw: string, fallback: string): string {
  return raw.trim().slice(0, 40) || fallback;
}

function isJoinFailure(value: unknown): value is { error: "room_full" | "join_rate_limited" } {
  return !!value && typeof value === "object" && "error" in value;
}

function joinFailureMessage(error: string): string {
  if (error === "room_full") return "That room is full. Create a new room instead.";
  if (error === "join_rate_limited") return "Too many people joined that room in the last minute. Try again shortly.";
  return "Could not join that room.";
}

function friendlyLiveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/room_code_taken/.test(message)) return "That room code already exists. Join it instead.";
  if (/weak_room_code/.test(message)) return "Room codes must be 6-12 letters or numbers.";
  if (/field_too_long/.test(message)) return "Name or title is too long.";
  if (/Failed to fetch|NetworkError/i.test(message)) return "Network error while connecting to the live backend. Try again.";
  return message;
}

function makeLiveRoomCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => (b % 36).toString(36)).join("").toUpperCase();
  return `NR${suffix}${Date.now().toString(36).toUpperCase().slice(-4)}`.slice(0, 12);
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
