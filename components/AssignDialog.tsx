"use client";

import { useEffect, useMemo, useState } from "react";
import { Ctx } from "./ctx";
import { CellPos, Position, POSITIONS, POSITION_LABEL } from "@/lib/types";
import { cellKey, cellsFor, isPresent, rotating, staffAt } from "@/lib/rotation";
import { suggestMover } from "@/lib/cover";
import { assignRange, paintCells } from "@/lib/store";
import { loadLabels, pushLabel, saveLabels } from "@/lib/labels";
import { alignAfter, fmt, fmtDuration, fromInput, toInput } from "@/lib/time";

const round5 = (t: number) => Math.round(t / 5) * 5;

const WHERE: { id: CellPos; label: string; cls: string }[] = [
  { id: "front", label: "Front", cls: "pos-front" },
  { id: "bar", label: "Bar", cls: "pos-bar" },
  { id: "dungeon", label: "Dungeon", cls: "pos-dungeon" },
  { id: "other", label: "Custom", cls: "pos-other" },
];

/**
 * Push an assignment, CDS style: send someone somewhere at a time, for as long as you say.
 * Shows what it does to the position they leave and the one they join, and offers a cover.
 */
export default function AssignDialog({
  ctx,
  shiftId,
  at,
  onClose,
}: {
  ctx: Ctx;
  shiftId?: string;
  at?: number;
  onClose: () => void;
}) {
  const { day, settings, now, mutate, flash } = ctx;
  const g = settings.gridMinutes;
  const crew = rotating(day.shifts).filter((s) => s.sentHomeAt == null);

  const firstShift = crew.find((s) => s.id === shiftId) ?? crew[0];
  const [who, setWho] = useState(firstShift?.id ?? "");
  const person = crew.find((s) => s.id === who) ?? firstShift;

  const [pos, setPos] = useState<CellPos>("front");
  const [label, setLabel] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(loadLabels()), []);

  const startGuess = round5(Math.min(Math.max(at ?? now ?? person?.start ?? 0, person?.start ?? 0), (person?.end ?? 0) - g));
  const [from, setFrom] = useState(startGuess);
  const blockEnd = (t: number) => {
    const rot = settings.rotationMinutes;
    const end = settings.anchor + (Math.floor((t - settings.anchor) / rot) + 1) * rot;
    return end - t < 15 ? end + rot : end;
  };
  const [until, setUntil] = useState(Math.min(blockEnd(startGuess), person?.end ?? startGuess + 60));
  const [useCover, setUseCover] = useState(true);

  const cellsAll = useMemo(() => cellsFor(day.shifts, settings), [day.shifts, settings]);
  const targetCells = useMemo(
    () => (person ? cellsAll.filter((c) => c + g > from && c < until && isPresent(person, c, g)) : []),
    [cellsAll, person, from, until, g],
  );
  const valid = !!person && until > from && targetCells.length > 0 && (pos !== "other" || label.trim().length > 0);

  // what this does to the board, judged at the worst moment of the assignment
  const impact = useMemo(() => {
    if (!person || !targetCells.length) return null;
    const draft = paintCells(day, person.id, targetCells, pos, label);
    const c0 = targetCells[0];
    const left = ((p) => (p && p !== "other" && p !== pos ? (p as Position) : null))(day.cells[cellKey(person.id, c0)]?.pos);

    let worstCell = c0;
    let leftNow: number | null = null;
    if (left) {
      for (const c of targetCells) {
        if (day.cells[cellKey(person.id, c)]?.pos !== left) continue;
        const n = staffAt(draft, settings, c)[left].length;
        if (leftNow == null || n < leftNow) {
          leftNow = n;
          worstCell = c;
        }
      }
    }
    const leftShort = left != null && leftNow != null && leftNow < settings.limits[left].min;
    const mover = left && leftShort ? suggestMover(draft, settings, left, worstCell, person.id, targetCells) : null;
    const joined = pos !== "other" ? staffAt(draft, settings, c0)[pos].length : null;
    return { left, leftNow, leftShort, mover, joined, c0 };
  }, [day, person, targetCells, pos, label, settings]);

  if (!person) {
    return (
      <div className="modal-back" onClick={onClose} role="presentation">
        <div className="modal card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <h2>Assign</h2>
          <p className="muted">Nobody on the rotation to assign yet.</p>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  function changeWho(id: string) {
    setWho(id);
    const p = crew.find((s) => s.id === id);
    if (!p) return;
    const f = round5(Math.min(Math.max(from, p.start), p.end - g));
    setFrom(f);
    setUntil(Math.min(blockEnd(f), p.end));
  }

  function changeFrom(v: number) {
    const dur = until - from;
    setFrom(v);
    setUntil(Math.min(v + Math.max(dur, 15), person!.end));
  }

  function confirm() {
    if (!valid || !person) return;
    const name = label.trim();
    const cover = useCover ? impact?.mover : null;
    mutate(
      (d) => {
        let next = assignRange(d, settings, person.id, from, until, pos, name);
        if (cover && impact?.left) next = assignRange(next, settings, cover.shift.id, from, until, impact.left);
        return next;
      },
      { auto: "fill" },
    );
    if (pos === "other" && name) {
      const next = pushLabel(recent, name);
      setRecent(next);
      saveLabels(next);
    }
    const where = pos === "other" ? name : POSITION_LABEL[pos];
    flash(
      `${person.name} → ${where} ${fmt(from)}–${fmt(until)}${cover ? ` · ${cover.shift.name} covers ${impact?.left ? POSITION_LABEL[impact.left] : ""}` : ""}`,
    );
    onClose();
  }

  const durations: { label: string; end: number }[] = [
    { label: "30 min", end: from + 30 },
    { label: "1 hr", end: from + 60 },
    { label: "2 hr", end: from + 120 },
    { label: "Rest of shift", end: person.end },
  ];

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div className="modal card assign" role="dialog" aria-modal="true" aria-label="Assign" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 6 }}>Assign</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Send someone somewhere at a set time. The rest of their day stays as it is.
        </p>

        <div className="stack">
          <label className="lbl">
            Who
            <select className="field" value={who} onChange={(e) => changeWho(e.target.value)}>
              {crew.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({fmt(s.start)}–{fmt(s.end)})
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="lbl">Where</div>
            <div className="where-grid" role="group" aria-label="Where">
              {WHERE.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`brush ${w.cls}`}
                  aria-pressed={pos === w.id}
                  onClick={() => setPos(w.id)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {pos === "other" && (
            <div>
              <input
                className="field"
                style={{ width: "100%", borderColor: "var(--other)" }}
                value={label}
                maxLength={24}
                placeholder="Type where, e.g. Tournament"
                aria-label="Custom position name"
                autoFocus
                onChange={(e) => setLabel(e.target.value)}
              />
              {recent.length > 0 && (
                <div className="chip-row" style={{ marginTop: 8 }}>
                  {recent.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="btn small"
                      aria-pressed={label.trim().toLowerCase() === r.toLowerCase()}
                      onClick={() => setLabel(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="two">
            <label className="lbl">
              From
              <input
                type="time"
                className="field"
                value={toInput(from)}
                onChange={(e) => {
                  const v = fromInput(e.target.value);
                  if (v != null) changeFrom(alignAfter(v, person.start));
                }}
              />
            </label>
            <label className="lbl">
              Until
              <input
                type="time"
                className="field"
                value={toInput(until)}
                onChange={(e) => {
                  const v = fromInput(e.target.value);
                  if (v != null) setUntil(Math.min(alignAfter(v, from), person.end));
                }}
              />
            </label>
          </div>
          <div className="chip-row">
            {durations.map((d, i) => {
              const end = Math.min(d.end, person.end);
              // only the first chip that lands on the chosen time lights up
              const active = until === end && durations.findIndex((x) => Math.min(x.end, person.end) === end) === i;
              return (
                <button key={d.label} type="button" className="btn small" aria-pressed={active} onClick={() => setUntil(end)}>
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="impact" aria-live="polite">
          {until <= from && <div className="note bad">Until needs to be after From.</div>}
          {until > from && targetCells.length === 0 && <div className="note bad">{person.name} is not working then.</div>}
          {valid && (
            <div className="note">
              {person.name} → <b>{pos === "other" ? label.trim() : POSITION_LABEL[pos]}</b>, {fmt(from)}–{fmt(until)} (
              {fmtDuration(until - from)})
            </div>
          )}
          {valid && impact?.leftShort && impact.left && (
            <div className={`note ${impact.leftNow === 0 ? "bad" : "warn"}`}>
              {POSITION_LABEL[impact.left]} drops to {impact.leftNow} (needs {settings.limits[impact.left].min}).
              {impact.mover && (
                <label className="checkbox" style={{ minHeight: 0, marginTop: 6 }}>
                  <input type="checkbox" checked={useCover} onChange={(e) => setUseCover(e.target.checked)} />
                  Move {impact.mover.shift.name} over from {POSITION_LABEL[impact.mover.from]} to cover
                </label>
              )}
              {!impact.mover && " Nobody can be spared to cover."}
            </div>
          )}
          {valid && pos !== "other" && impact?.joined != null && impact.joined > settings.limits[pos].max && (
            <div className="note warn">
              {POSITION_LABEL[pos]} would have {impact.joined} (max {settings.limits[pos].max}).
            </div>
          )}
          {valid && pos === "other" && (
            <div className="note">Custom spots are not counted as Front, Bar or Dungeon.</div>
          )}
        </div>

        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirm} disabled={!valid}>
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
