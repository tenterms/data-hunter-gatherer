import { NextResponse } from "next/server";
import { removeGroup, saveGroup, type GroupKind } from "@/lib/groupEditor";

function parseKind(value: unknown): GroupKind | null {
  return value === "topic" || value === "content" ? value : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const kind = parseKind(body.kind);
    if (!kind) return NextResponse.json({ ok: false, message: "Invalid group kind." }, { status: 400 });
    const result = await saveGroup({
      clientKey: String(body.clientKey ?? ""),
      kind,
      key: body.key ? String(body.key) : undefined,
      name: String(body.name ?? ""),
      description: body.description ? String(body.description) : "",
      contains: Array.isArray(body.contains) ? body.contains.map(String) : [],
      notContains: Array.isArray(body.notContains) ? body.notContains.map(String) : [],
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const kind = parseKind(body.kind);
    if (!kind) return NextResponse.json({ ok: false, message: "Invalid group kind." }, { status: 400 });
    const result = await removeGroup({
      clientKey: String(body.clientKey ?? ""),
      kind,
      key: String(body.key ?? ""),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Remove failed." },
      { status: 500 },
    );
  }
}
