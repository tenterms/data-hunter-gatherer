import { NextResponse } from "next/server";
import { scanMasterPages, saveMasterPages } from "@/lib/masterPages";

// A scan fetches every page in the sitemap, so give it room.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clientKey = String(body.clientKey ?? "");
    if (body.action === "scan") {
      const log: string[] = [];
      const result = await scanMasterPages(clientKey, (m) => log.push(m));
      return NextResponse.json({ ...result, log }, { status: result.ok ? 200 : 400 });
    }
    if (body.action === "save") {
      const result = await saveMasterPages(clientKey, Array.isArray(body.rows) ? body.rows : []);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Master list update failed." },
      { status: 500 },
    );
  }
}
