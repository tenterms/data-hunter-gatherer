import { NextResponse } from "next/server";
import { loadAdminConfig } from "@/lib/sheets";
import { replaceRowsAnywhere, cell } from "@/lib/rowStore";

/** Set which GSC property a client reads from (chosen in the property picker). */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clientKey = String(body.clientKey ?? "").trim();
    const propertyUrl = String(body.propertyUrl ?? "").trim();
    if (!clientKey || !propertyUrl) {
      return NextResponse.json({ ok: false, message: "clientKey and propertyUrl are required." }, { status: 400 });
    }
    const { config } = await loadAdminConfig();
    const client = config.clients.find((c) => c.client_key === clientKey);
    if (!client) {
      return NextResponse.json({ ok: false, message: "Unknown client." }, { status: 404 });
    }
    await replaceRowsAnywhere(
      "Clients",
      (row) => cell(row.client_key) === clientKey,
      [{ ...client, gsc_property_url: propertyUrl }],
    );
    return NextResponse.json({
      ok: true,
      message: `GSC property for ${client.client_name} set to ${propertyUrl}. The next report uses it.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Something went wrong." },
      { status: 500 },
    );
  }
}
