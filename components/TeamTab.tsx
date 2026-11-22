"use client";

import { useState } from "react";
import Avatar from "./Avatar";
import { Ctx } from "./ctx";
import { LEAD_LABEL, LeadRole, Position, POSITIONS, POSITION_LABEL, roleName, Shift } from "@/lib/types";
import { addShift, copyTeam, lastTeamBefore, removeShift, updateShift } from "@/lib/store";
import { requiredBreaks } from "@/lib/breaks";
import { fmt, fmtDuration, fmtHours, fromInput, hoursOf, normalizeEnd, toInput } from "@/lib/time";

const PRESETS: { label: string; start?: string; end?: string; floater?: boolean; assign?: string }[] = [
  { label: "Opening Lead 10–5:15", start: "10:00", end: "17:15", assign: "lead:opening" },
  { label: "Opener 11–5", start: "11:00", end: "17:00", assign: "" },
  { label: "Closer 5–11:15", start: "17:00", end: "23:15", assign: "" },
  { label: "Closer 5–11:45", start: "17:00", end: "23:45", assign: "" },
  { label: "Floater 1–9", start: "13:00", end: "21:00", floater: true, assign: "" },
  { label: "Closing Lead 5–11:45", start: "17:00", end: "23:45", assign: "lead:closing" },
  { label: "Inventory Lead", assign: "lead:inventory" },
];

/** One dropdown covers where someone works: rotating, staying put, or a lead role. */
function parseAssign(v: string): { lock: Position | null; role: LeadRole | null } {
  if (v.startsWith("lead:")) return { lock: null, role: v.slice(5) as LeadRole };
  return { lock: (v || null) as Position | null, role: null };
}
const assignOf = (s: Pick<Shift, "lock" | "role">) => (s.role ? `lead:${s.role}` : (s.lock ?? ""));

function AssignOptions({ keepCustom = false }: { keepCustom?: boolean }) {
  return (
    <>
      <option value="">Retail (on the board)</option>
      {POSITIONS.map((p) => (
        <option key={p} value={p}>
          Stays at {POSITION_LABEL[p]}
        </option>
      ))}
      {(Object.keys(LEAD_LABEL) as LeadRole[])
        .filter((r) => r !== "custom")
        .map((r) => (
          <option key={r} value={`lead:${r}`}>
            {LEAD_LABEL[r]}
          </option>
        ))}
      {keepCustom && <option value="lead:custom">Custom (typed name)</option>}
    </>
  );
}

function breakSummary(start: number, end: number) {
  const lens = requiredBreaks(hoursOf(start, end));
  return lens.map((l) => `${l}m`).join(" + ");
}

export default function TeamTab({ ctx }: { ctx: Ctx }) {
  const { day, settings, state, mutate, setSettings, remember, flash } = ctx;

  const [name, setName] = useState("");
  const [start, setStart] = useState("11:00");
  const [end, setEnd] = useState("17:00");
  const [assign, setAssign] = useState("");
  const [floater, setFloater] = useState(false);

  // names typed for custom assignments before, to offer again
  const customNames = Array.from(
    new Set(
      Object.values(state.days)
        .flatMap((d) => d.shifts)
        .map((s) => s.roleLabel?.trim() ?? "")
        .filter(Boolean),
    ),
  ).sort();

  const previous = lastTeamBefore(state, day.date);

  // the picture of whoever has signed in with one of the emails saved for this name
  const faceOf = (n: string): string | undefined => {
    const m = ctx.team.find((x) => x.name.trim().toLowerCase() === n.trim().toLowerCase());
    return (m?.email ?? "")
      .split(",")
      .map((e) => ctx.avatars[e.trim().toLowerCase()])
      .find(Boolean);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = fromInput(start);
    const en = fromInput(end);
    if (!name.trim() || s == null || en == null) return;
    remember(name);
    // a person typed in for the first time is saved, so the name is there next time
    if (!ctx.team.some((m) => m.name.trim().toLowerCase() === name.trim().toLowerCase())) {
      ctx.saveMember({ id: crypto.randomUUID(), name: name.trim() });
    }
    const { lock, role } = parseAssign(assign);
    mutate((d) => addShift(d, { name, start: s, end: en, lock, floater: role ? false : floater, role }), { auto: true });
    setName("");
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    if (p.start) setStart(p.start);
    if (p.end) setEnd(p.end);
    setFloater(!!p.floater);
    setAssign(p.assign ?? "");
  }

  return (
    <div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          <h2>Add to today&rsquo;s team</h2>
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
            Works as
            <select className="field" value={assign} onChange={(e) => setAssign(e.target.value)}>
              <AssignOptions />
            </select>
          </label>
          {!assign.startsWith("lead:") && (
            <label className="checkbox">
              <input type="checkbox" checked={floater} onChange={(e) => setFloater(e.target.checked)} />
              Floater
            </label>
          )}
          <button className="btn primary" type="submit">
            Add
          </button>
        </form>
        <datalist id="gds-roles">
          {customNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <datalist id="gds-names">
          {Array.from(new Set([...ctx.team.map((m) => m.name), ...state.names])).map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>

      <div className="section-title">
        <h2>Today&rsquo;s team</h2>
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

      <div className="card team-card">
        {!day.shifts.length && (
          <div className="empty" style={{ padding: "24px 8px" }}>
            Nobody on today yet.
          </div>
        )}
        <div className="team-scroll">
          {day.shifts.map((s) => (
            <div className="team-row" key={s.id}>
              <Avatar url={faceOf(s.name)} name={s.name} size={36} />
              <div className="team-name">
                <input
                  className="field"
                  list="gds-names"
                  aria-label="Name"
                  value={s.name}
                  onChange={(e) => mutate((d) => updateShift(d, s.id, { name: e.target.value }))}
                  onBlur={(e) => remember(e.target.value)}
                />
                <small className="muted">
                  {fmtHours(hoursOf(s.start, s.end))} · Breaks {s.breaks.length ? s.breaks.map((b) => `${b.length}m`).join(" + ") : "none"}
                  {s.sentHomeAt != null && " · bumped out"}
                </small>
              </div>
              <label className="mini">
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
              <label className="mini">
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
              <select
                className="field team-works"
                aria-label="Works as"
                value={assignOf(s)}
                onChange={(e) => {
                  const { lock, role } = parseAssign(e.target.value);
                  mutate((d) => updateShift(d, s.id, { lock, role, floater: role ? false : s.floater }), { auto: true });
                }}
              >
                <AssignOptions keepCustom={s.role === "custom"} />
              </select>
              {s.role === "custom" ? (
                <input
                  className="field team-extra"
                  list="gds-roles"
                  aria-label="Position name"
                  value={s.roleLabel ?? ""}
                  maxLength={24}
                  placeholder="Position name"
                  onChange={(e) => mutate((d) => updateShift(d, s.id, { roleLabel: e.target.value }))}
                />
              ) : s.role ? (
                <span className="badge team-extra">{roleName(s)}</span>
              ) : (
                <label className="checkbox team-extra">
                  <input
                    type="checkbox"
                    checked={s.floater}
                    onChange={(e) => mutate((d) => updateShift(d, s.id, { floater: e.target.checked }), { auto: true })}
                  />
                  Floater
                </label>
              )}
              <button
                className="btn ghost small team-x"
                aria-label={`Remove ${s.name}`}
                title="Remove from today"
                onClick={() => mutate((d) => removeShift(d, s.id), { auto: true })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">
        <h2>Settings</h2>
      </div>
      <div className="card settings-grid">
        <label className="lbl">
          Board starts at
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
          Time to get to next position
          <select
            className="field"
            value={settings.transitMinutes}
            onChange={(e) => setSettings({ transitMinutes: Number(e.target.value) })}
          >
            {[0, 5, 10].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "No time" : `${m} minutes`}
              </option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Most people on break at once
          <select
            className="field"
            value={settings.maxConcurrentBreaks}
            onChange={(e) => setSettings({ maxConcurrentBreaks: Number(e.target.value) })}
          >
            {[1, 2, 3].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Remind about bathroom checks every
          <select
            className="field"
            value={settings.checkMinutes}
            onChange={(e) => setSettings({ checkMinutes: Number(e.target.value) })}
          >
            {[30, 45, 60, 75, 90, 105, 120, 150, 180].map((m) => (
              <option key={m} value={m}>
                {fmtDuration(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="section-title">
        <h2>Staffing</h2>
      </div>
      <div className="card settings-grid staffing">
        {POSITIONS.map((p) => (
          <div key={p} className={`pos-${p}`}>
            <div className="staff-title">{POSITION_LABEL[p]}</div>
            <div className="row">
              <label className="lbl">
                At least
                <input
                  type="number"
                  className="field num"
                  min={0}
                  max={6}
                  value={settings.limits[p].min}
                  onChange={(e) => {
                    const min = Math.max(0, Math.min(6, Number(e.target.value) || 0));
                    setSettings({ limits: { ...settings.limits, [p]: { min, max: Math.max(min, settings.limits[p].max) } } });
                  }}
                />
              </label>
              <label className="lbl">
                At most
                <input
                  type="number"
                  className="field num"
                  min={1}
                  max={8}
                  value={settings.limits[p].max}
                  onChange={(e) => {
                    const max = Math.max(1, Math.min(8, Number(e.target.value) || 1));
                    setSettings({ limits: { ...settings.limits, [p]: { min: Math.min(settings.limits[p].min, max), max } } });
                  }}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
