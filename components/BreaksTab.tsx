"use client";

import { Ctx, FIRST_NAME } from "./ctx";
import { runBreakChange } from "./breakFlow";
import { Brk, DayState, POSITION_LABEL, roleName, Shift } from "@/lib/types";
import { SHIFT_RULES, breakStatus, effectiveStart } from "@/lib/breaks";
import { applyBreakChange } from "@/lib/cover";
import { breakImpact } from "@/lib/rotation";
import { addBreak, endBreak, removeBreak, resetBreak, startBreak, updateBreak } from "@/lib/store";
import { alignAfter, fmt, fmtDuration, fromInput, prettyDate, toInput } from "@/lib/time";

const byClockIn = (a: Shift, b: Shift) => a.start - b.start || a.name.localeCompare(b.name);

export default function BreaksTab({ ctx, goTeam }: { ctx: Ctx; goTeam: () => void }) {
  const { day, mutate } = ctx;

  if (!day.shifts.length) {
    return (
      <div className="card empty">
        <h2>No breaks to track yet</h2>
        <button className="btn primary" onClick={goTeam}>
          Add team
        </button>
      </div>
    );
  }

  const shifts = [...day.shifts].sort(byClockIn);
  const all = shifts.flatMap((s) => s.breaks.map((b) => ({ s, b })));
  const done = all.filter(({ b }) => breakStatus(b) === "done").length;
  const onBreak = all.filter(({ b }) => breakStatus(b) === "active");
  const next = all
    .filter(({ b }) => breakStatus(b) === "scheduled")
    .sort((a, b) => (effectiveStart(a.b) ?? 0) - (effectiveStart(b.b) ?? 0))[0];
  const unplaced = all.filter(({ b }) => breakStatus(b) === "unplanned").length;

  const leadName = (role: "opening" | "closing") => day.shifts.find((s) => s.role === role)?.name ?? "";

  return (
    <div>
      <div className="screen-only">
        <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <div>
            <strong>
              {done} of {all.length}
            </strong>{" "}
            <span className="muted">breaks taken</span>
          </div>
          {onBreak.length > 0 && (
            <div>
              <span className="badge green">On break</span> {onBreak.map(({ s }) => FIRST_NAME(s.name)).join(", ")}
            </div>
          )}
          {next && (
            <div>
              <span className="badge break">Next</span> {FIRST_NAME(next.s.name)} at {fmt(effectiveStart(next.b))}
            </div>
          )}
          {unplaced > 0 && <span className="badge">{unplaced} not scheduled yet</span>}
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => window.print()}>
            Print log
          </button>
        </div>

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
              placeholder={leadName("opening") || "Opening lead"}
            />
          </label>
          <label className="lbl">
            Closer
            <input
              className="field"
              value={day.closer}
              list="gds-names"
              onChange={(e) => mutate((d) => ({ ...d, closer: e.target.value }))}
              placeholder={leadName("closing") || "Closing lead"}
            />
          </label>
        </div>

        <div className="section" style={{ marginTop: 16 }}>
          <div className="scroll">
            <table className="log">
              <thead>
                <tr>
                  <th>Employee name</th>
                  <th>Clock in</th>
                  <th>Break length</th>
                  <th>Planned</th>
                  <th>Break start</th>
                  <th>Break end</th>
                  <th>Clock out</th>
                  <th>Emp. initials</th>
                  <th>Lead initials</th>
                  <th>Notes</th>
                  <th />
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

        <div className="section">
          <div className="section-title">
            <h2>Break rules</h2>
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

      <PrintLog day={day} shifts={shifts} opener={day.opener || leadName("opening")} closer={day.closer || leadName("closing")} />
    </div>
  );
}

/** The paper break log, laid out for a landscape page. Only shown when printing. */
function PrintLog({ day, shifts, opener, closer }: { day: DayState; shifts: Shift[]; opener: string; closer: string }) {
  const rows = shifts.flatMap((s) => {
    const list = [...s.breaks].sort((a, b) => (effectiveStart(a) ?? 1e9) - (effectiveStart(b) ?? 1e9));
    return (list.length ? list : [null]).map((b) => ({ s, b }));
  });
  return (
    <div className="print-log">
      <div className="print-head">
        <div>
          <b>Date:</b> {prettyDate(day.date)}
        </div>
        <div>
          <b>Opener:</b> {opener || "________________"}
        </div>
        <div>
          <b>Closer:</b> {closer || "________________"}
        </div>
      </div>
      <div className="print-title2">GEEK&rsquo;D DAILY BREAK LOG</div>
      <table className="plog">
        <colgroup>
          <col style={{ width: "17%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "22%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Employee name</th>
            <th>Clock in</th>
            <th>Break length</th>
            <th>Break start</th>
            <th>Break end</th>
            <th>Clock out</th>
            <th>Employee initials</th>
            <th>Lead initials</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, b }, i) => (
            <tr key={`${s.id}-${b?.id ?? i}`}>
              <td>
                {s.name}
                {s.role && <span className="plog-role"> ({roleName(s)})</span>}
              </td>
              <td>{fmt(s.start)}</td>
              <td>{b ? `${b.length} min` : ""}</td>
              <td className={b && b.start == null && b.planned != null ? "plan" : ""}>{b ? fmt(b.start ?? b.planned) : ""}</td>
              <td className={b && b.end == null && b.planned != null ? "plan" : ""}>
                {b ? (b.end != null ? fmt(b.end) : b.planned != null && b.start == null ? fmt(b.planned + b.length) : "") : ""}
              </td>
              <td>{fmt(s.end)}</td>
              <td>{b?.empInitials}</td>
              <td>{b?.leadInitials}</td>
              <td>{[b?.notes, s.sentHomeAt != null ? `Sent home ${fmt(s.sentHomeAt)}` : ""].filter(Boolean).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <td colSpan={9} className="muted wide">
          No breaks required
        </td>
        <td className="actions">
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
  const text = (p: Partial<Brk>) => mutate((d) => updateBreak(d, shift.id, brk.id, p));
  // anything that moves or resizes the break goes through the cover rule
  const change = (p: Partial<Brk>) =>
    runBreakChange(ctx, (d) => ({ day: updateBreak(d, shift.id, brk.id, p), breakId: brk.id }), { ask: false });
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
        {first && shift.role && <small>{roleName(shift)}</small>}
        {first && shift.floater && <small>Floater</small>}
        {impact && impact.position && (impact.status === "short" || impact.status === "open") && (
          <small style={{ color: impact.status === "open" ? "var(--danger)" : "var(--warn)" }}>
            {POSITION_LABEL[impact.position]} drops to {impact.remaining} (needs {impact.min})
          </small>
        )}
        {shift.sentHomeAt != null && <small>Sent home {fmt(shift.sentHomeAt)}</small>}
      </td>
      <td data-label="Clock in">{fmt(shift.start)}</td>
      <td data-label="Break length" className="len">
        <input
          type="number"
          className="field compact"
          min={5}
          max={120}
          step={5}
          value={brk.length}
          aria-label={`Break length for ${shift.name}`}
          onChange={(e) => change({ length: Math.max(5, Number(e.target.value) || 20) })}
        />{" "}
        <span className="muted">min</span>
      </td>
      <td data-label="Planned start">
        <input
          type="time"
          className="field compact"
          value={toInput(brk.planned)}
          aria-label={`Planned start for ${shift.name}`}
          onChange={(e) => {
            const v = time(e.target.value);
            if (v != null) change({ planned: v, locked: true });
          }}
        />
        {overdue && (
          <span className="badge danger" style={{ marginLeft: 6 }}>
            Late
          </span>
        )}
      </td>
      <td data-label="Break start">
        <input
          type="time"
          className="field compact"
          value={toInput(brk.start)}
          aria-label={`Break start for ${shift.name}`}
          onChange={(e) => change({ start: time(e.target.value) })}
        />
      </td>
      <td data-label="Break end">
        <input
          type="time"
          className="field compact"
          value={toInput(brk.end)}
          aria-label={`Break end for ${shift.name}`}
          onChange={(e) => change({ end: time(e.target.value) })}
        />
        {brk.start != null && brk.end != null && brk.end - brk.start !== brk.length && (
          <small style={{ display: "block", color: brk.end - brk.start > brk.length ? "var(--warn)" : "var(--muted)" }}>
            took {fmtDuration(brk.end - brk.start)}
          </small>
        )}
      </td>
      <td data-label="Clock out">{fmt(shift.end)}</td>
      <td data-label="Emp. initials">
        <input
          className="field compact init"
          maxLength={4}
          value={brk.empInitials}
          aria-label={`Employee initials for ${shift.name}`}
          onChange={(e) => text({ empInitials: e.target.value.toUpperCase() })}
        />
      </td>
      <td data-label="Lead initials">
        <input
          className="field compact init"
          maxLength={4}
          value={brk.leadInitials}
          aria-label={`Lead initials for ${shift.name}`}
          onChange={(e) => text({ leadInitials: e.target.value.toUpperCase() })}
        />
      </td>
      <td data-label="Notes" className="wide">
        <input
          className="field compact"
          value={brk.notes}
          aria-label={`Notes for ${shift.name}`}
          onChange={(e) => text({ notes: e.target.value })}
        />
      </td>
      <td className="actions" style={{ whiteSpace: "nowrap" }}>
        {status === "active" ? (
          <button
            className="btn primary small"
            disabled={now == null}
            onClick={() =>
              now != null &&
              mutate(
                (d) => applyBreakChange(d, settings, (dd) => ({ day: endBreak(dd, shift.id, brk.id, now), breakId: brk.id })),
                { auto: true },
              )
            }
          >
            End now
          </button>
        ) : status === "done" ? (
          <button
            className="btn ghost small"
            onClick={() =>
              mutate(
                (d) => applyBreakChange(d, settings, (dd) => ({ day: resetBreak(dd, shift.id, brk.id), breakId: brk.id })),
                { auto: true },
              )
            }
          >
            Undo
          </button>
        ) : (
          <button
            className="btn small"
            disabled={now == null}
            title={now == null ? "Pick today, or preview a time, to stamp" : undefined}
            onClick={() =>
              now != null && runBreakChange(ctx, (d) => ({ day: startBreak(d, shift.id, brk.id, now), breakId: brk.id }))
            }
          >
            Start now
          </button>
        )}
        {status === "active" && (
          <button
            className="btn ghost small"
            onClick={() =>
              mutate(
                (d) => applyBreakChange(d, settings, (dd) => ({ day: resetBreak(dd, shift.id, brk.id), breakId: brk.id })),
                { auto: true },
              )
            }
          >
            Undo
          </button>
        )}
        <button
          className="btn ghost small"
          aria-label="Remove this break"
          title="Remove this break"
          onClick={() =>
            mutate((d) => applyBreakChange(d, settings, (dd) => ({ day: removeBreak(dd, shift.id, brk.id), breakId: brk.id })), {
              auto: true,
            })
          }
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
