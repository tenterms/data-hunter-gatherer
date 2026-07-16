import { NextResponse } from "next/server";
import { savePages, type EditablePage } from "@/lib/pagesEditor";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await savePages({
      clientKey: String(body.clientKey ?? ""),
      pages: Array.isArray(body.pages) ? (body.pages as EditablePage[]) : [],
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}
