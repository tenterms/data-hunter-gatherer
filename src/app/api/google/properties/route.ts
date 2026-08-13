import { NextRequest, NextResponse } from "next/server";
import { googleConnectStatus, googleOAuthConnected, listGscProperties } from "@/lib/googleAuth";
import { loadAdminConfig } from "@/lib/sheets";

export const maxDuration = 30;

/**
 * Connection status + the GSC property list for the picker. When clientKey is
 * given, also returns that client's currently configured property.
 */
export async function GET(request: NextRequest) {
  const status = googleConnectStatus();
  const clientKey = request.nextUrl.searchParams.get("clientKey");

  let currentProperty: string | null = null;
  if (clientKey) {
    try {
      const { config } = await loadAdminConfig();
      currentProperty = config.clients.find((c) => c.client_key === clientKey)?.gsc_property_url ?? null;
    } catch {
      // config unavailable — picker still works without the current value
    }
  }

  let properties: Array<{ siteUrl: string; permissionLevel: string }> = [];
  let propertiesError: string | undefined;
  try {
    // Listed via OAuth when connected, else via the service account — either
    // way the picker shows what the credentials can actually see.
    properties = await listGscProperties();
  } catch (error) {
    propertiesError = error instanceof Error ? error.message : "Couldn't list properties.";
  }

  return NextResponse.json({
    ok: true,
    connected: status.connected,
    email: status.email ?? null,
    configured: status.configured,
    usingOAuth: googleOAuthConnected(),
    properties,
    propertiesError,
    currentProperty,
  });
}
