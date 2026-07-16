"use client";

import { useState } from "react";

/**
 * SEOGets-style chips input: type a term, press Enter (or comma) to add it as
 * a removable chip.
 */
export default function ChipsInput({
  value,
  onChange,
  placeholder = "query or keyword",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const term = draft.trim().toLowerCase();
    setDraft("");
    if (term && !value.includes(term)) onChange([...value, term]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="chips-input" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}>
      {value.map((chip) => (
        <span className="chip" key={chip}>
          {chip}
          <button
            type="button"
            aria-label={`remove ${chip}`}
            onClick={() => onChange(value.filter((c) => c !== chip))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : ""}
      />
    </div>
  );
}
