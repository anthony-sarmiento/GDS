"use client";

import { useState } from "react";
import { Ctx } from "./ctx";
import { Position, POSITIONS, POSITION_LABEL } from "@/lib/types";
import { addShift, copyTeam, lastTeamBefore, removeShift, updateShift } from "@/lib/store";
import { requiredBreaks } from "@/lib/breaks";
import { fmt, fmtHours, fromInput, hoursOf, normalizeEnd, toInput } from "@/lib/time";

const PRESETS: { label: string; start: string; end: string; floater?: boolean }[] = [
  { label: "Opener 10–5", start: "10:00", end: "17:00" },
  { label: "Closer 5–11", start: "17:00", end: "23:00" },
  { label: "Closer 5–12", start: "17:00", end: "00:00" },
  { label: "Floater 1–9", start: "13:00", end: "21:00", floater: true },
];

const ROTATION_CHOICES = [30, 45, 60, 90, 120];

function breakSummary(start: number, end: number) {
  const lens = requiredBreaks(hoursOf(start, end));
  return lens.map((l) => `${l}m`).join(" + ");
}

export default function TeamTab({ ctx }: { ctx: Ctx }) {
  const { day, settings, state, mutate, setSettings, remember, flash } = ctx;

  const [name, setName] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("17:00");
  const [lock, setLock] = useState<Position | "">("");
  const [floater, setFloater] = useState(false);

  const previous = lastTeamBefore(state, day.date);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = fromInput(start);
    const en = fromInput(end);
    if (!name.trim() || s == null || en == null) return;
    remember(name);
    mutate((d) => addShift(d, { name, start: s, end: en, lock: lock || null, floater }), { auto: true });
    setName("");
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setStart(p.start);
    setEnd(p.end);
    setFloater(!!p.floater);
  }

  return (
    <div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          <h2>Add to today&rsquo;s team</h2>
          <p>Type a name, pick the hours, and GDS plans the rotation and breaks.</p>
        </div>

        <div className="presets">
          <span className="muted">Quick fill:</span>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="btn small" onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>

        <form className="row" onSubmit={submit}>
          <label className="lbl" style={{ flex: "1 1 180px" }}>
            Name
            <input
              className="field"
              list="gds-names"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              autoComplete="off"
              required
            />
          </label>
          <label className="lbl">
            Clock in
            <input type="time" className="field" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="lbl">
            Clock out
            <input type="time" className="field" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </label>
          <label className="lbl">
            Position
            <select className="field" value={lock} onChange={(e) => setLock(e.target.value as Position | "")}>
              <option value="">Rotates</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  Stays at {POSITION_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={floater} onChange={(e) => setFloater(e.target.checked)} />
            Floater
          </label>
          <button className="btn primary" type="submit">
            Add
          </button>
        </form>
        <datalist id="gds-names">
          {state.names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>

      <div className="section-title">
        <h2>Today&rsquo;s team</h2>
        <p>Edit anything inline. Changes re-plan the rest of the day.</p>
        <span className="spacer" />
        {!day.shifts.length && previous && (
          <button
            className="btn"
            onClick={() => {
              mutate((d) => copyTeam(previous, d), { auto: true });
              flash(`Copied ${previous.shifts.length} people from ${previous.date}`);
            }}
          >
            Copy team from {previous.date}
          </button>
        )}
        {day.shifts.length > 0 && (
          <button
            className="btn danger"
            onClick={() => {
              if (window.confirm("Clear everyone and all breaks for this day?")) {
                mutate((d) => ({ ...d, shifts: [], cells: {} }));
              }
            }}
          >
            Clear day
          </button>
        )}
      </div>

      <div className="card">
        {!day.shifts.length && (
          <div className="empty" style={{ padding: "24px 8px" }}>
            Nobody on today yet. Add your openers, closers, and floater above.
          </div>
        )}
        {day.shifts.map((s) => (
          <div className="shift-row" key={s.id}>
            <label className="lbl">
              Name
              <input
                className="field"
                list="gds-names"
                value={s.name}
                onChange={(e) => mutate((d) => updateShift(d, s.id, { name: e.target.value }))}
                onBlur={(e) => remember(e.target.value)}
              />
            </label>
            <label className="lbl">
              In
              <input
                type="time"
                className="field"
                value={toInput(s.start)}
                onChange={(e) => {
                  const v = fromInput(e.target.value);
                  if (v != null) mutate((d) => updateShift(d, s.id, { start: v }), { auto: true });
                }}
              />
            </label>
            <label className="lbl">
              Out
              <input
                type="time"
                className="field"
                value={toInput(s.end)}
                onChange={(e) => {
                  const v = fromInput(e.target.value);
                  if (v != null) mutate((d) => updateShift(d, s.id, { end: normalizeEnd(s.start, v) }), { auto: true });
                }}
              />
            </label>
            <label className="lbl">
              Position
              <select
                className="field"
                value={s.lock ?? ""}
                onChange={(e) =>
                  mutate((d) => updateShift(d, s.id, { lock: (e.target.value || null) as Position | null }), {
                    auto: true,
                  })
                }
              >
                <option value="">Rotates</option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    Stays at {POSITION_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={s.floater}
                onChange={(e) => mutate((d) => updateShift(d, s.id, { floater: e.target.checked }), { auto: true })}
              />
              Floater
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {fmtHours(hoursOf(s.start, s.end))} · {fmt(s.start)}–{fmt(s.end)}
                <br />
                Breaks: {s.breaks.length ? s.breaks.map((b) => `${b.length}m`).join(" + ") : "none"}
                {!s.breaksCustom && s.breaks.length === 0 ? ` (rule: ${breakSummary(s.start, s.end)})` : ""}
              </span>
              <button
                className="btn danger small"
                aria-label={`Remove ${s.name}`}
                onClick={() => mutate((d) => removeShift(d, s.id), { auto: true })}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="section-title">
        <h2>Settings</h2>
        <p>Saved on this device.</p>
      </div>
      <div className="card settings-grid">
        <label className="lbl">
          Rotate positions every
          <select
            className="field"
            value={settings.rotationMinutes}
            onChange={(e) => {
              setSettings({ rotationMinutes: Number(e.target.value) });
              flash("Rotation re-dealt for this day");
            }}
          >
            {ROTATION_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Rotation clock starts at
          <input
            type="time"
            className="field"
            value={toInput(settings.anchor)}
            onChange={(e) => {
              const v = fromInput(e.target.value);
              if (v != null) setSettings({ anchor: v });
            }}
          />
        </label>
        <label className="lbl">
          Most people on break at once
          <select
            className="field"
            value={settings.maxConcurrentBreaks}
            onChange={(e) => setSettings({ maxConcurrentBreaks: Number(e.target.value) })}
          >
            <option value={1}>1 (recommended)</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
      </div>
    </div>
  );
}
