"use client";

import { Ctx, FIRST_NAME } from "./ctx";
import { Brk, POSITION_LABEL, Shift } from "@/lib/types";
import { SHIFT_RULES, breakStatus, effectiveStart } from "@/lib/breaks";
import { breakImpact } from "@/lib/rotation";
import { addBreak, endBreak, removeBreak, resetBreak, startBreak, updateBreak } from "@/lib/store";
import { alignAfter, fmt, fmtDuration, fromInput, toInput } from "@/lib/time";

export default function BreaksTab({ ctx, goTeam }: { ctx: Ctx; goTeam: () => void }) {
  const { day, mutate, flash } = ctx;

  if (!day.shifts.length) {
    return (
      <div className="card empty">
        <h2>No breaks to track yet</h2>
        <p>Add today&rsquo;s team first. Break lengths come from the shift length.</p>
        <button className="btn primary" onClick={goTeam}>
          Add team
        </button>
      </div>
    );
  }

  const shifts = [...day.shifts].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  const all = shifts.flatMap((s) => s.breaks.map((b) => ({ s, b })));
  const done = all.filter(({ b }) => breakStatus(b) === "done").length;
  const onBreak = all.filter(({ b }) => breakStatus(b) === "active");
  const next = all
    .filter(({ b }) => ["scheduled"].includes(breakStatus(b)))
    .sort((a, b) => (effectiveStart(a.b) ?? 0) - (effectiveStart(b.b) ?? 0))[0];
  const unplaced = all.filter(({ b }) => breakStatus(b) === "unplanned").length;

  return (
    <div>
      <div className="card no-print" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <div>
          <strong>
            {done} of {all.length}
          </strong>{" "}
          <span className="muted">breaks taken</span>
        </div>
        {onBreak.length > 0 && (
          <div>
            <span className="badge green">On break</span>{" "}
            {onBreak.map(({ s }) => FIRST_NAME(s.name)).join(", ")}
          </div>
        )}
        {next && (
          <div>
            <span className="badge break">Next</span> {FIRST_NAME(next.s.name)} at {fmt(effectiveStart(next.b))}
          </div>
        )}
        {unplaced > 0 && <span className="badge warn">{unplaced} with no time planned</span>}
        <span style={{ flex: 1 }} />
        <button
          className="btn"
          onClick={() => {
            mutate((d) => d, { replanBreaks: true, auto: "cells" });
            flash("Breaks re-planned (taken and hand-set breaks kept)");
          }}
        >
          Re-plan breaks
        </button>
        <button className="btn primary" onClick={() => window.print()}>
          Print log
        </button>
      </div>

      <div className="section">
        <div className="log-head card" style={{ marginTop: 16 }}>
          <label className="lbl">
            Date
            <input className="field" value={day.date} readOnly />
          </label>
          <label className="lbl">
            Opener
            <input
              className="field"
              value={day.opener}
              list="gds-names"
              onChange={(e) => mutate((d) => ({ ...d, opener: e.target.value }))}
              placeholder="Opening lead"
            />
          </label>
          <label className="lbl">
            Closer
            <input
              className="field"
              value={day.closer}
              list="gds-names"
              onChange={(e) => mutate((d) => ({ ...d, closer: e.target.value }))}
              placeholder="Closing lead"
            />
          </label>
        </div>
      </div>

      <div className="section" style={{ marginTop: 16 }}>
        <div className="scroll">
          <table className="log">
            <thead>
              <tr>
                <th>Employee name</th>
                <th>Clock in</th>
                <th>Break length</th>
                <th className="no-print">Planned</th>
                <th>Break start</th>
                <th>Break end</th>
                <th>Clock out</th>
                <th>Emp. initials</th>
                <th>Lead initials</th>
                <th>Notes</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <ShiftRows key={s.id} ctx={ctx} shift={s} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section no-print">
        <div className="section-title">
          <h2>Break rules</h2>
          <p>From the GEEK&rsquo;D daily break log. Lengths are editable per break.</p>
        </div>
        <table className="rules">
          <thead>
            <tr>
              <th>Shift length</th>
              <th>Required break(s)</th>
            </tr>
          </thead>
          <tbody>
            {SHIFT_RULES.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{r.breaks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShiftRows({ ctx, shift }: { ctx: Ctx; shift: Shift }) {
  const { mutate } = ctx;
  const breaks = [...shift.breaks].sort((a, b) => (effectiveStart(a) ?? 1e9) - (effectiveStart(b) ?? 1e9));

  if (!breaks.length) {
    return (
      <tr className="group-start">
        <td className="name">{shift.name}</td>
        <td colSpan={9} className="muted">
          No breaks required
        </td>
        <td className="no-print">
          <button className="btn small" onClick={() => mutate((d) => addBreak(d, shift.id))}>
            + Break
          </button>
        </td>
      </tr>
    );
  }

  return (
    <>
      {breaks.map((b, i) => (
        <BreakRow key={b.id} ctx={ctx} shift={shift} brk={b} first={i === 0} last={i === breaks.length - 1} />
      ))}
    </>
  );
}

function BreakRow({ ctx, shift, brk, first, last }: { ctx: Ctx; shift: Shift; brk: Brk; first: boolean; last: boolean }) {
  const { day, settings, now, mutate } = ctx;
  const status = breakStatus(brk);
  const patch = (p: Partial<Brk>) =>
    mutate((d) => updateBreak(d, shift.id, brk.id, p), {
      // anything that moves the break changes who is on the floor, so re-deal the board
      auto: "planned" in p || "start" in p || "end" in p || "length" in p ? "cells" : undefined,
    });
  const time = (v: string) => {
    const m = fromInput(v);
    return m == null ? null : alignAfter(m, shift.start);
  };

  const at = effectiveStart(brk);
  const impact = status === "scheduled" && at != null ? breakImpact(day, settings, shift, at) : null;
  const overdue = status === "scheduled" && now != null && at != null && now - at > 15;

  return (
    <tr className={`${status} ${first ? "group-start" : ""}`}>
      <td className="name">
        {shift.name || "(no name)"}
        {first && shift.floater && <small>Floater</small>}
        {impact && impact.position && (impact.status === "short" || impact.status === "open") && (
          <small style={{ color: impact.status === "open" ? "var(--danger)" : "var(--warn)" }}>
            {POSITION_LABEL[impact.position]} drops to {impact.remaining} (needs {impact.min})
          </small>
        )}
        {shift.sentHomeAt != null && <small>Sent home {fmt(shift.sentHomeAt)}</small>}
      </td>
      <td>{fmt(shift.start)}</td>
      <td>
        <input
          type="number"
          className="field compact"
          min={5}
          max={120}
          step={5}
          value={brk.length}
          aria-label={`Break length for ${shift.name}`}
          onChange={(e) => patch({ length: Math.max(5, Number(e.target.value) || 20) })}
        />{" "}
        <span className="muted no-print">min</span>
      </td>
      <td className="no-print">
        <input
          type="time"
          className="field compact"
          value={toInput(brk.planned)}
          aria-label={`Planned start for ${shift.name}`}
          onChange={(e) => {
            const v = time(e.target.value);
            if (v != null) patch({ planned: v, locked: true });
          }}
        />
        {overdue && <span className="badge danger" style={{ marginLeft: 6 }}>Late</span>}
      </td>
      <td>
        <input
          type="time"
          className="field compact"
          value={toInput(brk.start)}
          aria-label={`Break start for ${shift.name}`}
          onChange={(e) => patch({ start: time(e.target.value) })}
        />
      </td>
      <td>
        <input
          type="time"
          className="field compact"
          value={toInput(brk.end)}
          aria-label={`Break end for ${shift.name}`}
          onChange={(e) => patch({ end: time(e.target.value) })}
        />
        {brk.start != null && brk.end != null && brk.end - brk.start !== brk.length && (
          <small className="no-print" style={{ display: "block", color: brk.end - brk.start > brk.length ? "var(--warn)" : "var(--muted)" }}>
            took {fmtDuration(brk.end - brk.start)}
          </small>
        )}
      </td>
      <td>{fmt(shift.end)}</td>
      <td>
        <input
          className="field compact"
          style={{ width: 64 }}
          maxLength={4}
          value={brk.empInitials}
          aria-label={`Employee initials for ${shift.name}`}
          onChange={(e) => patch({ empInitials: e.target.value.toUpperCase() })}
        />
      </td>
      <td>
        <input
          className="field compact"
          style={{ width: 64 }}
          maxLength={4}
          value={brk.leadInitials}
          aria-label={`Lead initials for ${shift.name}`}
          onChange={(e) => patch({ leadInitials: e.target.value.toUpperCase() })}
        />
      </td>
      <td>
        <input
          className="field compact"
          value={brk.notes}
          aria-label={`Notes for ${shift.name}`}
          onChange={(e) => patch({ notes: e.target.value })}
        />
      </td>
      <td className="no-print" style={{ whiteSpace: "nowrap" }}>
        {status === "active" ? (
          <button className="btn primary small" disabled={now == null} onClick={() => now != null && mutate((d) => endBreak(d, shift.id, brk.id, now), { auto: "cells" })}>
            End now
          </button>
        ) : status === "done" ? (
          <button className="btn ghost small" onClick={() => mutate((d) => resetBreak(d, shift.id, brk.id), { auto: "cells" })}>
            Undo
          </button>
        ) : (
          <button className="btn small" disabled={now == null} title={now == null ? "Pick today, or preview a time, to stamp" : undefined} onClick={() => now != null && mutate((d) => startBreak(d, shift.id, brk.id, now), { auto: "cells" })}>
            Start now
          </button>
        )}
        {status === "active" && (
          <button className="btn ghost small" onClick={() => mutate((d) => resetBreak(d, shift.id, brk.id), { auto: "cells" })}>
            Undo
          </button>
        )}
        <button
          className="btn ghost small"
          aria-label="Remove this break"
          title="Remove this break"
          onClick={() => mutate((d) => removeBreak(d, shift.id, brk.id), { auto: "cells" })}
        >
          ✕
        </button>
        {last && (
          <button className="btn ghost small" title="Add another break" onClick={() => mutate((d) => addBreak(d, shift.id))}>
            + Break
          </button>
        )}
      </td>
    </tr>
  );
}
