"use client";

import { useState } from "react";
import CoverPicker from "./CoverPicker";
import { CoverPrompt } from "./ctx";
import { POSITION_LABEL } from "@/lib/types";

/** "Who rotates over?" - asked every time someone goes on break. You choose; GDS only suggests. */
export default function CoverDialog({ prompt, onClose }: { prompt: CoverPrompt; onClose: () => void }) {
  const { position, remaining, min } = prompt;
  const needs = remaining < min;
  // when a cover is needed nothing is preselected; when it is optional the default is Nobody
  const [choice, setChoice] = useState<string | null | undefined>(needs ? undefined : null);
  const place = POSITION_LABEL[position];

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div
        className="modal card assign"
        role="dialog"
        aria-modal="true"
        aria-label={prompt.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: 4 }}>{prompt.title}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          <b style={{ color: "var(--text)" }}>{place}</b> · {prompt.when}
        </p>

        <div className={`note ${needs ? (remaining === 0 ? "bad" : "warn") : ""}`}>
          {needs
            ? remaining === 0
              ? `${place} would be empty without a cover.`
              : `${place} would drop to ${remaining} (needs ${min}).`
            : `${place} keeps ${remaining} without ${prompt.holder}, so a cover is optional.`}
        </div>

        <div style={{ marginTop: 14 }}>
          <CoverPicker
            position={position}
            options={prompt.options}
            remaining={remaining}
            min={min}
            choice={choice}
            onChoose={setChoice}
          />
        </div>

        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={choice === undefined}
            onClick={() => {
              prompt.onConfirm(choice ?? null);
              onClose();
            }}
          >
            {prompt.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
