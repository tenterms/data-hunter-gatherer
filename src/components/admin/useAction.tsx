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

  /**
   * Start a background job (POST) and poll a status URL until it finishes,
   * surfacing the job's latest log line as live progress.
   */
  async function runJob(startUrl: string, body: Record<string, unknown>, statusUrl: string): Promise<boolean> {
    setState({ busy: true, message: "Starting…", ok: null });
    try {
      const response = await fetch(startUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { ok: boolean; message: string };
      if (!data.ok) {
        setState({ busy: false, message: data.message, ok: false });
        return false;
      }
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const statusRes = await fetch(statusUrl);
        const status = (await statusRes.json()) as {
          job: { finished: boolean; ok?: boolean; message?: string; log: string[] } | null;
        };
        if (!status.job) {
          setState({ busy: false, message: "The server restarted mid-generation — start it again.", ok: false });
          return false;
        }
        if (status.job.finished) {
          setState({ busy: false, message: status.job.message ?? "Done.", ok: status.job.ok ?? false });
          if (status.job.ok) router.refresh();
          return status.job.ok ?? false;
        }
        setState({ busy: true, message: status.job.log[status.job.log.length - 1] ?? "Generating…", ok: null });
      }
    } catch (error) {
      setState({
        busy: false,
        message: error instanceof Error ? error.message : "Something went wrong.",
        ok: false,
      });
      return false;
    }
  }

  return { state, run, runJob };
}

export function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  const cls = state.ok === false ? "action-msg error" : state.ok ? "action-msg success" : "action-msg";
  return <p className={cls}>{state.message}</p>;
}
