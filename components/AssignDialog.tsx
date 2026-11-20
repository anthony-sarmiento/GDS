"use client";

import { useEffect, useMemo, useState } from "react";
import { Ctx } from "./ctx";
import CoverPicker from "./CoverPicker";
import { CellPos, Position, POSITION_LABEL } from "@/lib/types";
import { cellKey, cellsFor, isPresent, rotating, staffAt } from "@/lib/rotation";
import { analyzeCover, applyBreakChange, coverOptions } from "@/lib/cover";
import { assignRange, paintCells, placeBreak } from "@/lib/store";
import { loadLabels, pushLabel, saveLabels } from "@/lib/labels";
import { alignAfter, fmt, fmtDuration, fromInput, toInput } from "@/lib/time";
import { breakKind, breaksOwed, KIND_LABEL, onLog } from "@/lib/breaks";

const round5 = (t: number) => Math.round(t / 5) * 5;

type Where = CellPos | "break";

const WHERE: { id: Where; label: string; cls: string }[] = [
  { id: "front", label: "Front", cls: "pos-front" },
  { id: "bar", label: "Bar", cls: "pos-bar" },
  { id: "dungeon", label: "Dungeon", cls: "pos-dungeon" },
  { id: "other", label: "Custom", cls: "pos-other" },
  { id: "break", label: "Break", cls: "brush-break" },
];

/**
 * Push an assignment, CDS style: send someone somewhere (or on break) at a time, for as long as you say.
 * Shows what it does to the position they leave, and lets you choose who rotates over. Nothing is
 * moved unless you pick it.
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

  const [where, setWhere] = useState<Where>("front");
  const [label, setLabel] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(loadLabels()), []);

  // the break log decides the default: the first break this person still owes (20, or 30 for the long kind)
  const breakLen = (p: typeof person) =>
    (p?.breaks.find((b) => b.start == null && b.planned == null) ?? p?.breaks.find((b) => b.start == null))?.length ?? 20;
  const blockEnd = (t: number) => {
    const rot = settings.rotationMinutes;
    const end = settings.anchor + (Math.floor((t - settings.anchor) / rot) + 1) * rot;
    return end - t < 15 ? end + rot : end;
  };
  const startGuess = round5(Math.min(Math.max(at ?? now ?? person?.start ?? 0, person?.start ?? 0), (person?.end ?? 0) - g));
  const [from, setFrom] = useState(startGuess);
  const [until, setUntil] = useState(Math.min(blockEnd(startGuess), person?.end ?? startGuess + 60));
  // undefined = nothing picked yet, null = Nobody, otherwise the shift id of who rotates over
  const [coverChoice, setCoverChoice] = useState<string | null | undefined>(undefined);
  useEffect(() => setCoverChoice(undefined), [who, where, from, until]);

  const isBreak = where === "break";
  const cellsAll = useMemo(() => cellsFor(day.shifts, settings), [day.shifts, settings]);
  const targetCells = useMemo(
    () => (person ? cellsAll.filter((c) => c + g > from && c < until && isPresent(person, c, g)) : []),
    [cellsAll, person, from, until, g],
  );
  const valid =
    !!person && until > from && targetCells.length > 0 && (where !== "other" || label.trim().length > 0);

  // what this does to the board, judged at the worst moment of the stretch
  const impact = useMemo(() => {
    if (!person || !targetCells.length) return null;

    if (where === "break") {
      const probe = placeBreak(day, person.id, from, until - from);
      const a = probe.breakId ? analyzeCover(probe.day, settings, person.id, probe.breakId) : null;
      if (!a || !a.position) return { position: null as Position | null, needs: false, remaining: 0, min: 0, options: [], joined: null as number | null };
      return { position: a.position, needs: a.needs, remaining: a.remaining, min: a.min, options: a.options, joined: null as number | null };
    }

    const draft = paintCells(day, person.id, targetCells, where, label);
    const c0 = targetCells[0];
    const left = ((p) => (p && p !== "other" && p !== where ? (p as Position) : null))(day.cells[cellKey(person.id, c0)]?.pos);
    let worst = c0;
    let leftNow: number | null = null;
    if (left) {
      for (const c of targetCells) {
        if (day.cells[cellKey(person.id, c)]?.pos !== left) continue;
        const n = staffAt(draft, settings, c)[left].length;
        if (leftNow == null || n < leftNow) {
          leftNow = n;
          worst = c;
        }
      }
    }
    const joined = where !== "other" ? staffAt(draft, settings, c0)[where].length : null;
    if (!left || leftNow == null) return { position: null as Position | null, needs: false, remaining: 0, min: 0, options: [], joined };
    const o = coverOptions(draft, settings, left, [worst, ...targetCells.filter((c) => c !== worst)], person.id);
    return { position: left, needs: o.needs, remaining: leftNow, min: o.min, options: o.options, joined };
  }, [day, person, targetCells, where, label, settings, from, until]);

  const position = impact?.position ?? null;
  const needsCover = !!impact?.needs;
  // a cover is required for a short position; for a break it is optional when the position stays staffed
  const showPicker = valid && position != null && (needsCover || isBreak);
  const effective = coverChoice === undefined && !needsCover ? null : coverChoice;
  const blocked = showPicker && needsCover && effective === undefined;

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
    setUntil(Math.min(isBreak ? f + breakLen(p) : blockEnd(f), p.end));
  }

  function changeFrom(v: number) {
    const dur = until - from;
    setFrom(v);
    setUntil(Math.min(v + Math.max(dur, 5), person!.end));
  }

  function changeWhere(w: Where) {
    setWhere(w);
    if (w === "break") setUntil(Math.min(from + breakLen(person), person!.end));
    else if (isBreak) setUntil(Math.min(blockEnd(from), person!.end));
  }

  function confirm() {
    if (!valid || !person || blocked) return;
    const name = label.trim();
    const chosen = crew.find((s) => s.id === effective);

    if (isBreak) {
      mutate(
        (d) => applyBreakChange(d, settings, (dd) => placeBreak(dd, person.id, from, until - from), effective ?? null),
        { auto: "fill" },
      );
      flash(
        `${person.name} on break ${fmt(from)}–${fmt(until)}${chosen && position ? ` · ${chosen.name} covers ${POSITION_LABEL[position]}` : ""}`,
      );
      onClose();
      return;
    }

    mutate(
      (d) => {
        let next = assignRange(d, settings, person.id, from, until, where, name);
        if (chosen && position) next = assignRange(next, settings, chosen.id, from, until, position);
        return next;
      },
      { auto: "fill" },
    );
    if (where === "other" && name) {
      const next = pushLabel(recent, name);
      setRecent(next);
      saveLabels(next);
    }
    const dest = where === "other" ? name : POSITION_LABEL[where as Position];
    flash(
      `${person.name} → ${dest} ${fmt(from)}–${fmt(until)}${chosen && position ? ` · ${chosen.name} covers ${POSITION_LABEL[position]}` : ""}`,
    );
    onClose();
  }

  // what the break log says about the break being placed
  const owed = breaksOwed(person);
  const kind = breakKind(until - from);
  const breakLength = until - from;
  const logNote = ((): { cls: string; text: string } | null => {
    if (!isBreak || !valid) return null;
    if (!onLog(breakLength))
      return { cls: "warn", text: `The log has 20 min or 30–60 min breaks. ${fmtDuration(breakLength)} is off the log.` };
    if (owed[kind].unplaced > 0) return null;
    if (owed[kind].placed > 0)
      return { cls: "", text: `${person.name}'s ${KIND_LABEL[kind]} break is already placed, so this moves it.` };
    return { cls: "warn", text: `${person.name}'s log has no ${KIND_LABEL[kind]} break left, so this counts as an extra break.` };
  })();
  const owedText = (["short", "long"] as const)
    .filter((k) => owed[k].unplaced + owed[k].placed > 0)
    .map((k) => `${KIND_LABEL[k]} × ${owed[k].unplaced + owed[k].placed}`)
    .join(" · ");

  const durations: { label: string; end: number; hint?: string }[] = isBreak
    ? [20, 30, 45, 60].map((m) => ({
        label: `${m} min`,
        end: from + m,
        hint: owed[breakKind(m)].unplaced > 0 ? "due" : undefined,
      }))
    : [
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
          Send someone somewhere, or on break, at a set time. You choose who rotates over.
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
                  aria-pressed={where === w.id}
                  onClick={() => changeWhere(w.id)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {where === "other" && (
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
                  {d.hint && <small className="chip-hint">{d.hint}</small>}
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
              {person.name} → <b>{isBreak ? "Break" : where === "other" ? label.trim() : POSITION_LABEL[where as Position]}</b>,{" "}
              {fmt(from)}–{fmt(until)} ({fmtDuration(until - from)})
            </div>
          )}
          {isBreak && person && (
            <div className="muted log-line">
              Break log: {owedText ? `still owed ${owedText}` : "all of this person's breaks are taken"}
            </div>
          )}
          {logNote && <div className={`note ${logNote.cls}`}>{logNote.text}</div>}
          {valid && position && (
            <div className={`note ${needsCover ? (impact?.remaining === 0 ? "bad" : "warn") : ""}`}>
              {needsCover
                ? impact?.remaining === 0
                  ? `${POSITION_LABEL[position]} would be empty.`
                  : `${POSITION_LABEL[position]} would drop to ${impact?.remaining} (needs ${impact?.min}).`
                : `${POSITION_LABEL[position]} keeps ${impact?.remaining} without ${person.name}.`}
            </div>
          )}
          {valid && !isBreak && where !== "other" && impact?.joined != null && impact.joined > settings.limits[where as Position].max && (
            <div className="note warn">
              {POSITION_LABEL[where as Position]} would have {impact.joined} (max {settings.limits[where as Position].max}).
            </div>
          )}
          {valid && where === "other" && <div className="note">Custom spots are not counted as Front, Bar or Dungeon.</div>}
        </div>

        {showPicker && impact && position && (
          <div style={{ marginTop: 14 }}>
            <CoverPicker
              position={position}
              options={impact.options}
              remaining={impact.remaining}
              min={impact.min}
              choice={effective}
              onChoose={setCoverChoice}
            />
          </div>
        )}

        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirm} disabled={!valid || blocked}>
            {isBreak ? "Send on break" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}
