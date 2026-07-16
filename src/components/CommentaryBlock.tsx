import type { SectionCommentary } from "@/lib/types";

/**
 * Read-only commentary block. Used in the client share view (no badges, no
 * internals — just the final text). The team view uses EditableCommentary.
 */
export default function CommentaryBlock({
  commentary,
  readOnly = false,
}: {
  commentary: SectionCommentary | undefined;
  readOnly?: boolean;
}) {
  if (!commentary || commentary.finalText.trim() === "") return null;
  if (readOnly) {
    return <div className="commentary clean">{commentary.finalText}</div>;
  }
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
      </div>
      {commentary.finalText}
    </div>
  );
}
