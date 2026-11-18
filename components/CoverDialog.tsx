"use client";

import { useState } from "react";
import { CoverPrompt } from "./ctx";
import { CoverOption } from "@/lib/cover";
import { POSITION_LABEL } from "@/lib/types";

function effect(o: CoverOption): { text: string; tone: "ok" | "warn" | "bad" } {
  const left = POSITION_LABEL[o.from];
  if (o.harm === "none") return { text: `${left} stays staffed`, tone: "ok" };
  if (o.harm === "short") return { text: `${left} drops to ${o.fromAfter} (needs ${o.fromMin})`, tone: "warn" };
  return { text: `Leaves ${left} empty`, tone: "bad" };
}

/** "Who rotates over?" - asked every time someone goes on break. */
export default function CoverDialog({ prompt, onClose }: { prompt: CoverPrompt; onClose: () => void }) {
  const { position, options, remaining, min } = prompt;
  const needs = remaining < min;
  const suggested = options.find((o) => o.recommended);
  const [choice, setChoice] = useState<string | null>(suggested?.shift.id ?? null);
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

        <div className="lbl" style={{ marginTop: 14 }}>
          Who rotates to {place}?
        </div>
        <div className="cover-list" role="radiogroup" aria-label={`Who rotates to ${place}`}>
          {options.map((o) => {
            const e = effect(o);
            const on = choice === o.shift.id;
            return (
              <button
                key={o.shift.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={`cover-opt pos-${o.from}`}
                onClick={() => setChoice(o.shift.id)}
              >
                <span className="cover-name">
                  {o.shift.name}
                  {o.recommended && <span className="badge green">Suggested</span>}
                  {o.shift.floater && <span className="badge">Floater</span>}
                  {o.locked && <span className="badge">Stays</span>}
                </span>
                <span className="cover-from">
                  now on <b style={{ color: "var(--pos)" }}>{POSITION_LABEL[o.from]}</b>
                </span>
                <span className={`cover-effect ${e.tone}`}>{e.text}</span>
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={choice === null}
            className="cover-opt none"
            onClick={() => setChoice(null)}
          >
            <span className="cover-name">Nobody</span>
            <span className={`cover-effect ${needs ? "warn" : "ok"}`}>
              {needs ? `${place} runs at ${remaining} of ${min}` : "No cover needed"}
            </span>
          </button>
        </div>
        {options.length === 0 && <p className="muted">Nobody else is free to rotate over for this whole break.</p>}

        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              prompt.onConfirm(choice);
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
