"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ActionState {
  busy: boolean;
  message: string | null;
  ok: boolean | null;
}

/** Small helper: POST to an admin API route, show the result, refresh the page data. */
export function useAction() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ busy: false, message: null, ok: null });

  async function run(url: string, body: FormData | Record<string, unknown>): Promise<boolean> {
    setState({ busy: true, message: "Working…", ok: null });
    try {
      const response = await fetch(url, {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      const data = (await response.json()) as { ok: boolean; message: string };
      setState({ busy: false, message: data.message, ok: data.ok });
      if (data.ok) router.refresh();
      return data.ok;
    } catch (error) {
      setState({
        busy: false,
        message: error instanceof Error ? error.message : "Something went wrong.",
        ok: false,
      });
      return false;
    }
  }

  return { state, run };
}

export function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  const cls = state.ok === false ? "action-msg error" : state.ok ? "action-msg success" : "action-msg";
  return <p className={cls}>{state.message}</p>;
}
