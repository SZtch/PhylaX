import { NextResponse } from "next/server";
import { verifySession } from "../../../../lib/privy-auth";
import { runAgentLoop } from "../../../../lib/anthropic";
import { getDb, schema } from "../../../../lib/db";
import { eq, sql, and } from "drizzle-orm";
import { checkRateLimit } from "../../../../lib/rate-limit";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const allowed = await checkRateLimit(`chat_stream:${ip}`, 30, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  let body: { conversationId?: string; message?: string; chain?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { conversationId, message, chain } = body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: "Message is too long. Max length is 4000 characters." }, { status: 400 });
  }
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required." }, { status: 400 });
  }

  const auth = await verifySession(req);
  if (!auth.authenticated || !auth.session) {
    return NextResponse.json({ error: auth.error ?? "Please sign in to use PhylaX." }, { status: auth.statusCode || 401 });
  }

  const db = getDb();

  if (db) {
    try {
      const conversation = await db.query.conversations.findFirst({
        where: and(
          eq(schema.conversations.id, conversationId),
          eq(schema.conversations.privyUserId, auth.session.userId)
        ),
      });

      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found or unauthorized" }, { status: 404 });
      }

      await db.insert(schema.messages).values({
        conversationId,
        role: "user",
        content: message,
      });

      const [msgCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId));

      if (Number(msgCount.count) <= 1) {
        const title = message.length > 40 ? message.slice(0, 37) + "..." : message;
        await db.update(schema.conversations).set({ title, updatedAt: new Date() }).where(eq(schema.conversations.id, conversationId));
      } else {
        await db.update(schema.conversations).set({ updatedAt: new Date() }).where(eq(schema.conversations.id, conversationId));
      }
    } catch (err) {
      console.error("[api/chat/stream] Failed to persist user message:", err);
    }
  }

  let history: { role: "user" | "assistant"; content: string }[] = [];
  if (db) {
    try {
      const recentMessages = await db.query.messages.findMany({
        where: eq(schema.messages.conversationId, conversationId),
        orderBy: [sql`${schema.messages.createdAt} desc`],
        limit: 10,
      });
      history = recentMessages
        .reverse()
        .filter(m => m.content !== message)
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    } catch (err) {
      console.error("[api/chat/stream] Failed to fetch history context:", err);
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: Record<string, unknown>) => {
        const payload = JSON.stringify({ type, ...data });
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${payload}\n\n`));
      };

      try {
        const result = await runAgentLoop(message, chain, history, conversationId, (type, data) => {
          sendEvent(type, data);
        }, auth.session!.walletAddress);

        if (db) {
          try {
            await db.insert(schema.messages).values({
              conversationId,
              role: "assistant",
              content: result.agentMessage,
              metadata: result.pipelineData as Record<string, unknown>,
              toolCalls: result.toolCallsLog as unknown,
            });
          } catch (err) {
            console.error("[api/chat/stream] Failed to persist assistant message:", err);
          }
        }

        sendEvent("final", {
          agentMessage: result.agentMessage,
          action: result.action,
          chatState: result.chatState,
          pipelineData: result.pipelineData
        });
        controller.close();
      } catch (err) {
        sendEvent("error", { error: err instanceof Error ? err.message : "Unknown error" });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}
