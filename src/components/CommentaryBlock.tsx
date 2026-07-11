import type { SectionCommentary } from "@/lib/types";

/**
 * Shows the final commentary used in the report, its source mode, and — when a
 * human override is in effect — the original suggestion collapsed underneath.
 * Overrides are managed in the NarrativeOverrides tab of the Google Sheet.
 */
export default function CommentaryBlock({ commentary }: { commentary: SectionCommentary | undefined }) {
  if (!commentary) return null;
  const modeLabel =
    commentary.mode === "human_override"
      ? "human override"
      : commentary.mode === "llm_draft"
        ? "LLM draft"
        : "rules-based";
  return (
    <div className={`commentary${commentary.mode === "human_override" ? " overridden" : ""}`}>
      <div className="meta">
        <span className="badge">{modeLabel}</span>
        {commentary.mode !== "human_override" && (
          <span>Override via the NarrativeOverrides sheet (section: {commentary.section})</span>
        )}
      </div>
      {commentary.finalText}
      {commentary.overrideText && (
        <details className="suggested-collapsed">
          <summary>Show original {commentary.suggestedSource === "llm_draft" ? "LLM" : "rules-based"} suggestion</summary>
          <p>{commentary.suggestedText}</p>
        </details>
      )}
    </div>
  );
}
