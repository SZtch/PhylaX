import { NextResponse } from "next/server";
import { verifySession } from "../../../lib/privy-auth";
import { runAgentLoop } from "../../../lib/anthropic";
import { getDb, schema } from "../../../lib/db";
import { eq, sql, and } from "drizzle-orm";
import { checkRateLimit } from "../../../lib/rate-limit";

/**
 * POST /api/chat
 *
 * Wallet-gated chat endpoint for PhylaX.
 * Uses Tool Registry + LLM Tool-Use Architecture Foundation.
 */
export async function POST(req: Request) {
  // ── 1. Verify user session ───────────────────
  const auth = await verifySession(req);
  if (!auth.authenticated || !auth.session) {
    return NextResponse.json(
      { error: auth.error ?? "Please sign in to use PhylaX." },
      { status: auth.statusCode || 401 }
    );
  }

  // ── 2. Parse request body ───────────────────────────────────────────────
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
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required." }, { status: 400 });
  }

  const db = getDb();

  // ── 3. Persist User Message & Update Title ──────────────────────────────
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
        await db
          .update(schema.conversations)
          .set({ title, updatedAt: new Date() })
          .where(eq(schema.conversations.id, conversationId));
      } else {
        await db
          .update(schema.conversations)
          .set({ updatedAt: new Date() })
          .where(eq(schema.conversations.id, conversationId));
      }
    } catch (err) {
      console.error("[api/chat] Failed to persist user message:", err);
    }
  }

  // ── 4. Retrieve History ───────────────────────────────────────────
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
        .map(m => ({ 
          role: m.role as "user" | "assistant", 
          content: m.content 
        }));
    } catch (err) {
      console.error("[api/chat] Failed to fetch history context:", err);
    }
  }

  // ── 5. Run Agent Loop ───────────────────────────────────────────────────
  const result = await runAgentLoop(message, chain, history, conversationId, undefined, auth.session!.walletAddress);

  // ── 6. Persist Assistant Message ────────────────────────────────────────
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
      console.error("[api/chat] Failed to persist assistant message:", err);
    }
  }

  return NextResponse.json({
    agentMessage: result.agentMessage,
    action: result.action,
    chatState: result.chatState,
    conversationId,
    pipelineData: result.pipelineData,
    error: result.error,
  });
}
