"use client";

import { CoverOption } from "@/lib/cover";
import { Position, POSITION_LABEL } from "@/lib/types";

function effect(o: CoverOption): { text: string; tone: "ok" | "warn" | "bad" } {
  const left = POSITION_LABEL[o.from];
  if (o.harm === "none") return { text: `${left} stays staffed`, tone: "ok" };
  if (o.harm === "short") return { text: `${left} drops to ${o.fromAfter} (needs ${o.fromMin})`, tone: "warn" };
  return { text: `Leaves ${left} empty`, tone: "bad" };
}

/**
 * Pick who rotates over to a position. Nothing is chosen for you when a cover is needed:
 * the suggestion is only marked, and you have to pick someone (or Nobody).
 * `choice`: undefined = not picked yet, null = Nobody, otherwise a shift id.
 */
export default function CoverPicker({
  position,
  options,
  remaining,
  min,
  choice,
  onChoose,
}: {
  position: Position;
  options: CoverOption[];
  remaining: number;
  min: number;
  choice: string | null | undefined;
  onChoose: (choice: string | null) => void;
}) {
  const needs = remaining < min;
  const place = POSITION_LABEL[position];
  return (
    <div>
      <div className="lbl">Who rotates to {place}?</div>
      <div className="cover-list" role="radiogroup" aria-label={`Who rotates to ${place}`}>
        {options.map((o) => {
          const e = effect(o);
          return (
            <button
              key={o.shift.id}
              type="button"
              role="radio"
              aria-checked={choice === o.shift.id}
              className={`cover-opt pos-${o.from}`}
              onClick={() => onChoose(o.shift.id)}
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
          onClick={() => onChoose(null)}
        >
          <span className="cover-name">Nobody</span>
          <span className={`cover-effect ${needs ? "warn" : "ok"}`}>
            {needs ? `${place} runs at ${remaining} of ${min}` : "No cover needed"}
          </span>
        </button>
      </div>
      {options.length === 0 && <p className="muted">Nobody else is free to rotate over for this whole stretch.</p>}
      {needs && choice === undefined && <p className="muted" style={{ marginBottom: 0 }}>Pick someone, or Nobody, to continue.</p>}
    </div>
  );
}
