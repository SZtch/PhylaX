import { NextResponse } from "next/server";
import { getSignals, OkxRealModeError } from "../../../lib/okx";
import { checkRateLimit } from "../../../lib/rate-limit";
import { verifySession } from "../../../lib/privy-auth";
import { z } from "zod";

const SignalRequestSchema = z.object({
  chain: z.string().optional(),
  chainId: z.string().optional(),
  maxTokens: z.number().optional(),
});

function normalizeChain(chain?: string, chainId?: string): string {
  if (chain) {
    const lower = chain.toLowerCase().replace(/\s+/g, "");
    if (lower === "xlayer") return "xlayer";
    return chain;
  }
  if (chainId === "196") return "xlayer";
  if (chainId === "8453") return "base";
  if (chainId === "1") return "ethereum";
  return "xlayer";
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const allowed = await checkRateLimit(`signals:${ip}`, 30, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }
  
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SignalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request schema", details: parsed.error.format() }, { status: 400 });
  }

  const auth = await verifySession(req);
  if (!auth.authenticated || !auth.session) {
    return NextResponse.json({ error: auth.error ?? "Please sign in to use PhylaX." }, { status: auth.statusCode || 401 });
  }

  const { chain, chainId, maxTokens } = parsed.data;
  const resolvedChain = normalizeChain(chain, chainId);

  try {
    const { signals, meta } = await getSignals(resolvedChain, maxTokens ?? 10);
    return NextResponse.json({ signals, meta });
  } catch (err) {
    if (err instanceof OkxRealModeError) {
      return NextResponse.json(
        { error: err.message, meta: err.meta, integration: "okx-dex-signal" },
        { status: 502 }
      );
    }
    console.error("Signal discovery error:", err);
    return NextResponse.json({ error: "Failed to fetch signals" }, { status: 500 });
  }
}
