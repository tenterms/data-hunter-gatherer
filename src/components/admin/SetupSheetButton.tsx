"use client";

import { ActionMessage, useAction } from "./useAction";

export default function SetupSheetButton() {
  const { state, run } = useAction();
  return (
    <div>
      <button className="btn" disabled={state.busy} onClick={() => run("/api/admin/setup-sheet", {})}>
        {state.busy ? "Checking…" : "Create / check sheet tabs"}
      </button>
      <ActionMessage state={state} />
    </div>
  );
}
