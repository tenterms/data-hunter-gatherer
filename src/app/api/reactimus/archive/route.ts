import { NextResponse } from "next/server";
import { archiveReactimusSuggestion, restoreReactimusSuggestion } from "@/lib/reactimus";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = { clientKey: String(body.clientKey ?? ""), key: String(body.key ?? "") };
    const result =
      String(body.action ?? "archive") === "restore"
        ? await restoreReactimusSuggestion(input)
        : await archiveReactimusSuggestion(input);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Archive failed." },
      { status: 500 },
    );
  }
}
