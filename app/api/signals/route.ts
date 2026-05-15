import { NextResponse } from "next/server";
import { getSignals, OkxRealModeError } from "../../../lib/okx";
import { ThesisIntentSchema } from "../../../lib/schemas";
import { checkRateLimit } from "../../../lib/rate-limit";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const allowed = await checkRateLimit(`signals:${ip}`, 30, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }
  try {
    const body = await req.json();
    const intent = ThesisIntentSchema.parse(body.intent);

    const { signals, meta } = await getSignals(intent.chain, intent.maxTokens);
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
