"use client";

import { useMemo, useState } from "react";
import { Ctx } from "./ctx";
import { Dest, Move, afterRotation, applyRotation, floorAt, suggestRotation } from "@/lib/rotate";
import { alignAfter, fmt, fromInput, toInput } from "@/lib/time";
import { Position, POSITIONS, POSITION_LABEL } from "@/lib/types";

const round5 = (t: number) => Math.round(t / 5) * 5;

const OPTIONS: { id: Dest; label: string }[] = [
  { id: "stay", label: "Stay" },
  { id: "front", label: "Front" },
  { id: "bar", label: "Bar" },
  { id: "dungeon", label: "Dungeon" },
  { id: "break", label: "Break" },
];

/** A rotation: everyone who is on the floor at a time moves at once, to a new position or on break. */
export default function RotateDialog({
  ctx,
  onClose,
  header,
}: {
  ctx: Ctx;
  onClose: () => void;
  /** The mode switch, supplied by the Assign dialog. */
  header: React.ReactNode;
}) {
  const { day, settings, now, mutate, flash } = ctx;
  const earliest = Math.min(...day.shifts.map((s) => s.start));
  const [time, setTime] = useState(round5(Math.max(now ?? earliest, earliest)));
  const people = useMemo(() => floorAt(day, settings, time), [day, settings, time]);

  const [picked, setPicked] = useState<Record<string, Dest>>({});
  // until edited, each person shows the suggested move for this time
  const suggestion = useMemo(() => suggestRotation(day, settings, time), [day, settings, time]);
  const moves: Move[] = people.map(({ shift }) => ({
    shiftId: shift.id,
    dest: picked[shift.id] ?? suggestion.find((m) => m.shiftId === shift.id)?.dest ?? "stay",
  }));

  const counts = afterRotation(day, settings, time, moves);
  const changing = moves.filter((m) => m.dest !== "stay").length;

  function confirm() {
    mutate((d) => applyRotation(d, settings, time, moves), { auto: true });
    flash(`Rotated at ${fmt(time)} · ${changing} move${changing === 1 ? "" : "s"}`);
    onClose();
  }

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div className="modal card assign" role="dialog" aria-modal="true" aria-label="Rotation" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 10 }}>Assign</h2>
        {header}

        <label className="lbl" style={{ marginTop: 12 }}>
          At
          <input
            type="time"
            className="field"
            value={toInput(time)}
            onChange={(e) => {
              const v = fromInput(e.target.value);
              if (v != null) {
                setTime(alignAfter(v, earliest));
                setPicked({});
              }
            }}
          />
        </label>

        <div className="rot-list">
          {people.length === 0 && <div className="muted">Nobody is on a position at {fmt(time)}.</div>}
          {people.map(({ shift, pos }) => {
            const dest = moves.find((m) => m.shiftId === shift.id)!.dest;
            return (
              <div className={`rot-row pos-${pos}`} key={shift.id}>
                <b>{shift.name}</b>
                <span className="rot-from">{POSITION_LABEL[pos]}</span>
                <span aria-hidden>→</span>
                <select
                  className="field"
                  value={dest}
                  aria-label={`Where ${shift.name} goes`}
                  onChange={(e) => setPicked({ ...picked, [shift.id]: e.target.value as Dest })}
                >
                  {OPTIONS.filter((o) => o.id !== pos).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.id === "stay" ? `Stay on ${POSITION_LABEL[pos]}` : o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {people.length > 0 && (
          <div className="rot-counts">
            {POSITIONS.map((p: Position) => {
              const { min, max } = settings.limits[p];
              const n = counts[p];
              const tone = n < min ? (n === 0 ? "bad" : "warn") : n > max ? "warn" : "ok";
              return (
                <span key={p} className={`rot-count ${tone} pos-${p}`}>
                  {POSITION_LABEL[p]} <b>{n}</b>
                </span>
              );
            })}
          </div>
        )}

        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirm} disabled={changing === 0}>
            Rotate
          </button>
        </div>
      </div>
    </div>
  );
}
