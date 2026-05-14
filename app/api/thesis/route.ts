import { NextResponse } from "next/server";
import { parseThesis } from "../../../lib/anthropic";

export async function POST(req: Request) {
  try {
    const { thesis } = await req.json();

    if (!thesis || typeof thesis !== "string") {
      return NextResponse.json({ error: "Thesis must be a non-empty string" }, { status: 400 });
    }

    const intent = await parseThesis(thesis);

    return NextResponse.json({ intent });
  } catch (error) {
    console.error("Thesis parsing error:", error);
    return NextResponse.json({ error: "Failed to parse thesis" }, { status: 500 });
  }
}
