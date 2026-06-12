/**
 * HTTP surface — currently one route: the persistent-text-streaming driver for private NodeAgent
 * replies. The driving browser tab POSTs { streamId, requester } here and receives the token stream over
 * HTTP while the component persists sentence-flushed chunks to the DB for every other
 * tab/refresh (they read via streaming.getStreamBody). A second drive attempt gets the
 * component's 205 and falls back to the DB body — never a duplicate generation.
 *
 * CORS is open (*) like the component's reference app, but the endpoint still checks the room's
 * actor proof before generation starts. A second drive attempt gets the component's 205.
 */
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { StreamId } from "@convex-dev/persistent-text-streaming";
import { streamingComponent } from "./streaming";
import { streamPrivateReplyText } from "./streamingModel";
import { privateAgentSystemPrompt } from "./agent";

const http = httpRouter();

const CORS = { "Access-Control-Allow-Origin": "*", Vary: "Origin" } as const;
type ActorProofBody = { actor: { kind: "user" | "agent"; id: string; name: string; scope?: "public" | "private"; ownerId?: string }; token: string };

http.route({
  path: "/stream-private-reply",
  method: "OPTIONS",
  handler: httpAction(async () =>
    new Response(null, {
      status: 204,
      headers: { ...CORS, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" },
    })),
});

http.route({
  path: "/stream-private-reply",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => null)) as { streamId?: string; requester?: ActorProofBody } | null;
    const streamId = body?.streamId;
    if (!streamId || typeof streamId !== "string") {
      return new Response("missing streamId", { status: 400, headers: CORS });
    }
    if (!body?.requester || typeof body.requester !== "object") {
      return new Response("missing requester", { status: 400, headers: CORS });
    }
    let meta;
    try {
      meta = await ctx.runQuery(internal.streaming.streamMeta, { streamId, requester: body.requester });
    } catch {
      return new Response("forbidden", { status: 403, headers: CORS });
    }
    if (!meta) return new Response("unknown stream", { status: 404, headers: CORS });

    const response = await streamingComponent.stream(ctx, request, streamId as StreamId, async (streamCtx, _req, _sid, append) => {
      const system = privateAgentSystemPrompt(meta.requesterName);
      const userMsg = `ROOM CONTEXT\n${meta.roomContext}\n\n${meta.requesterName} asks: ${meta.goal}`;
      let answer = "";
      try {
        answer = await streamPrivateReplyText(process.env.AGENT_MODEL ?? "gemini-3.5-flash", system, userMsg, append);
      } catch (error) {
        // HONEST_STATUS: the partial text persists, the error is visible text, never a silent 2xx void.
        const msg = `(private agent error: ${error instanceof Error ? error.message.slice(0, 160) : "model call failed"})`;
        await append(answer ? `\n${msg}` : msg);
        answer = answer ? `${answer}\n${msg}` : msg;
      }
      if (!answer.trim()) {
        answer = "I read the room but have nothing to add yet — ask me something specific about the data.";
        await append(answer);
      }
      await streamCtx.runMutation(internal.streaming.finalizeStreamMessage, { roomId: meta.roomId, clientMsgId: meta.clientMsgId, text: answer });
    });
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Vary", "Origin");
    return response;
  }),
});

export default http;
