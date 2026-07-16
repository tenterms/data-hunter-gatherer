import { NextResponse } from "next/server";
import { saveDrawTasks, type EditableTask } from "@/lib/drawEditor";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await saveDrawTasks({
      clientKey: String(body.clientKey ?? ""),
      periodKey: String(body.periodKey ?? ""),
      tasks: Array.isArray(body.tasks) ? (body.tasks as EditableTask[]) : [],
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}
