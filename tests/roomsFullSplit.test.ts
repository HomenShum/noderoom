// @vitest-environment edge-runtime
/**
 * RUNTIME proof for B1 — splitting rooms.full into rooms.meta (the room shell, NO cell elements) +
 * artifacts.elements (per-artifact). A cell edit changes one `elements` row, so only
 * artifacts.elements(thatArtifact) re-runs; rooms.meta's read-set excludes elements, so its output is
 * byte-identical across an edit → it does NOT re-ship. The whole-room O(E·U) re-serialization shrinks
 * to O(edited-artifact). Real Convex queries against an in-memory deployment (convex-test), no deploy.
 */
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"]; // "use node" action — not needed here

const TOK = "split-token-abcdefghij0123456789-XYZ";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };
const SHAPES = [60, 40, 30, 15]; // 145 elements across 4 artifacts — mirrors the live Q3DEMO scale

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", { code: "SPLIT1", title: "Q3 diligence", hostId: "pending", autoAllow: true, status: "live" as const, createdAt: now });
    const memberId = await ctx.db.insert("members", { roomId, name: "Homen", role: "host" as const, anon: false, color: "#d97757", authTokenHash: await hashToken(TOK), lastSeenAt: now });
    await ctx.db.patch(roomId, { hostId: String(memberId) });
    const artIds: Id<"artifacts">[] = [];
    for (let ai = 0; ai < SHAPES.length; ai++) {
      const artId = await ctx.db.insert("artifacts", { roomId, kind: "sheet" as const, title: `sheet${ai}`, version: 1, order: [], updatedAt: now, meta: {} });
      for (let c = 0; c < SHAPES[ai]; c++) {
        await ctx.db.insert("elements", { artifactId: artId, elementId: `r${c}__v`, value: `cell ${ai}-${c} value with some realistic length`, version: 1, updatedAt: now, updatedBy: AGENT });
      }
      artIds.push(artId);
    }
    return { roomId, memberId, artIds };
  });
}

const proof = (memberId: string) => ({ actor: { kind: "user" as const, id: String(memberId), name: "Homen" }, token: TOK });

test("B1: rooms.meta carries the room shell but NO cell elements, and is a small fraction of rooms.full", async () => {
  const t = convexTest(schema, modules);
  const { roomId, memberId } = await seed(t);

  const full = await t.query(api.rooms.full, { roomId, requester: proof(memberId) });
  const meta = await t.query(api.rooms.meta, { roomId, requester: proof(memberId) });

  expect(meta!.artifacts.length).toBe(full!.artifacts.length);
  expect((full!.artifacts[0] as Record<string, unknown>).elements).toBeDefined(); // full carries cells
  expect((meta!.artifacts[0] as Record<string, unknown>).elements).toBeUndefined(); // meta does not
  const fullBytes = JSON.stringify(full).length;
  const metaBytes = JSON.stringify(meta).length;
  expect(metaBytes).toBeLessThan(fullBytes / 3); // the room shell is a fraction of the whole-room payload
});

test("B1: artifacts.elements is scoped to a single artifact", async () => {
  const t = convexTest(schema, modules);
  const { roomId, memberId, artIds } = await seed(t);
  const els0 = await t.query(api.artifacts.elements, { roomId, artifactId: artIds[0], requester: proof(memberId) });
  const els3 = await t.query(api.artifacts.elements, { roomId, artifactId: artIds[3], requester: proof(memberId) });
  expect(Object.keys(els0).length).toBe(SHAPES[0]);
  expect(Object.keys(els3).length).toBe(SHAPES[3]);
});

test("B1: a cell edit changes ONLY the edited artifact's elements — rooms.meta stays byte-identical (read-set scoping)", async () => {
  const t = convexTest(schema, modules);
  const { roomId, memberId, artIds } = await seed(t);

  const metaBefore = JSON.stringify(await t.query(api.rooms.meta, { roomId, requester: proof(memberId) }));
  const els0Before = JSON.stringify(await t.query(api.artifacts.elements, { roomId, artifactId: artIds[0], requester: proof(memberId) }));
  const els3Before = JSON.stringify(await t.query(api.artifacts.elements, { roomId, artifactId: artIds[3], requester: proof(memberId) }));

  // What a CAS commit does to one cell: bump the element's version + value.
  await t.run(async (ctx) => {
    const el = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artIds[0]).eq("elementId", "r0__v")).unique();
    await ctx.db.patch(el!._id, { value: "EDITED", version: el!.version + 1, updatedAt: Date.now() });
  });

  const metaAfter = JSON.stringify(await t.query(api.rooms.meta, { roomId, requester: proof(memberId) }));
  const els0After = JSON.stringify(await t.query(api.artifacts.elements, { roomId, artifactId: artIds[0], requester: proof(memberId) }));
  const els3After = JSON.stringify(await t.query(api.artifacts.elements, { roomId, artifactId: artIds[3], requester: proof(memberId) }));

  expect(metaAfter).toBe(metaBefore); // meta unchanged on a cell edit -> would NOT re-ship
  expect(els0After).not.toBe(els0Before); // only the edited artifact's elements changed
  expect(els3After).toBe(els3Before); // an unrelated artifact's elements are untouched

  // The re-shipped payload (edited artifact's cells) is far smaller than the whole-room re-ship.
  const fullBytes = JSON.stringify(await t.query(api.rooms.full, { roomId, requester: proof(memberId) })).length;
  expect(els0After.length).toBeLessThan(fullBytes / 2);
});
