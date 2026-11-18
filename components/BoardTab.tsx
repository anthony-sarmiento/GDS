"use client";

import { Ctx, FIRST_NAME } from "./ctx";
import { Brk, Position, POSITIONS, POSITION_LABEL, Shift } from "@/lib/types";
import { breakStatus, effectiveStart } from "@/lib/breaks";
import { cellKey, coverFor, isPresent, positionMinutes, slotAt, slotsFor } from "@/lib/rotation";
import { endBreak, startBreak } from "@/lib/store";
import { fmt, fmtDuration, fmtShort } from "@/lib/time";

const posOf = (ctx: Ctx, s: Shift, slot: number | null) =>
  slot == null ? undefined : ctx.day.cells[cellKey(s.id, slot)]?.pos;

export default function BoardTab({ ctx, goTeam }: { ctx: Ctx; goTeam: () => void }) {
  const { day, settings, now, mutate } = ctx;
  const step = settings.rotationMinutes;
  const slots = slotsFor(day.shifts, settings);

  if (!day.shifts.length) {
    return (
      <div className="card empty">
        <h2>Nobody on the board yet</h2>
        <p>Add today&rsquo;s team and GDS will build the rotation and break plan.</p>
        <button className="btn primary" onClick={goTeam}>
          Add team
        </button>
      </div>
    );
  }

  const currentSlot = now == null ? null : slotAt(slots, step, now);

  return (
    <div>
      {now != null && <NowPanel ctx={ctx} slot={currentSlot} />}
      {now != null && <BreakQueue ctx={ctx} />}

      <div className="section-title">
        <h2>Rotation</h2>
        <p>Tap a block to change it. Changed blocks are pinned and auto-rotate works around them.</p>
        <span className="spacer" />
        <button
          className="btn"
          onClick={() => {
            const from = now ?? -Infinity;
            mutate(
              (d) => ({
                ...d,
                // keep hand-set blocks; drop everything else from now on so it is dealt again
                cells: Object.fromEntries(
                  Object.entries(d.cells).filter(([k, c]) => c.pinned || Number(k.split("@")[1]) < from),
                ),
              }),
              { auto: true },
            );
            ctx.flash(now != null ? "Re-dealt the rest of the day" : "Rotation re-dealt");
          }}
        >
          {now != null ? "Re-deal from now" : "Auto-rotate"}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            mutate((d) => ({ ...d, cells: Object.fromEntries(Object.entries(d.cells).map(([k, c]) => [k, { ...c, pinned: false }])) }), { auto: true });
            ctx.flash("Unpinned everything and re-dealt");
          }}
        >
          Unpin all
        </button>
      </div>

      <Grid ctx={ctx} slots={slots} currentSlot={currentSlot} />

      <div className="legend" style={{ marginTop: 10 }}>
        {POSITIONS.map((p) => (
          <span key={p} className={`pos-${p}`}>
            <i />
            {POSITION_LABEL[p]}
          </span>
        ))}
        <span>
          <i style={{ background: "var(--break)" }} />
          Break
        </span>
        <span>● pinned by hand</span>
      </div>

      <div className="section-title">
        <h2>Coverage</h2>
        <p>Who is on each position, block by block. Red means nobody is there.</p>
      </div>
      <Coverage ctx={ctx} slots={slots} currentSlot={currentSlot} />

      <div className="section-title">
        <h2>Time at each position</h2>
        <p>Aiming for an even split. People who stay put are marked.</p>
      </div>
      <Fairness ctx={ctx} />
    </div>
  );
}

/* ---------- live panel ---------- */

function activeBreak(s: Shift): Brk | undefined {
  return s.breaks.find((b) => b.start != null && b.end == null);
}

function NowPanel({ ctx, slot }: { ctx: Ctx; slot: number | null }) {
  const { day, settings, now } = ctx;
  const step = settings.rotationMinutes;
  const t = now!;
  const onFloor = day.shifts.filter((s) => s.start <= t && t < s.end);

  const nextRotation = slot == null ? null : slot + step;

  return (
    <div className="section">
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>Right now</h2>
        <p>
          {fmt(t)}
          {nextRotation != null && nextRotation < Math.max(...day.shifts.map((s) => s.end)) &&
            ` · next rotation at ${fmt(nextRotation)} (${fmtDuration(nextRotation - t)})`}
        </p>
      </div>
      {onFloor.length === 0 && <div className="card muted">Nobody is clocked in at this time.</div>}
      {onFloor.length > 0 && (
        <div className="now-grid">
          {POSITIONS.map((p) => {
            const here = onFloor.filter((s) => posOf(ctx, s, slot) === p);
            const working = here.filter((s) => !activeBreak(s));
            const out = here.filter((s) => activeBreak(s));
            // someone from another position standing in during a break
            const open = working.length === 0;
            return (
              <div key={p} className={`pos-card pos-${p} ${open ? "open" : ""}`}>
                <header>
                  <h3>{POSITION_LABEL[p]}</h3>
                  <span className="muted">{working.length} on</span>
                </header>
                {working.map((s) => (
                  <div className="person" key={s.id}>
                    {s.name}
                    {s.floater && <span className="badge">Floater</span>}
                    {s.lock && <span className="badge">Stays</span>}
                    <small>until {fmtShort(Math.min(slot != null ? slot + step : s.end, s.end))}</small>
                  </div>
                ))}
                {out.map((s) => {
                  const b = activeBreak(s)!;
                  const plan = coverFor(day, settings, s, b.start!);
                  return (
                    <div key={s.id}>
                      <div className="person out">
                        ☕ {s.name} <small>back ~{fmtShort(b.start! + b.length)}</small>
                      </div>
                      {open && plan.status === "cover" && plan.cover && (
                        <div className="person cover">
                          Cover: {plan.cover.name}
                          {plan.coverFrom && <small>from {POSITION_LABEL[plan.coverFrom]}</small>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {open && <div className="open-label" style={{ marginTop: 10 }}>{out.length ? "Needs cover" : "Nobody here"}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BreakQueue({ ctx }: { ctx: Ctx }) {
  const { day, settings, now, mutate } = ctx;
  const t = now!;

  const items = day.shifts
    .flatMap((s) => s.breaks.map((b) => ({ s, b })))
    .filter(({ s, b }) => breakStatus(b) !== "done" && s.start <= t + 180 && t < s.end + 60)
    .map((x) => ({ ...x, at: effectiveStart(x.b) }))
    .sort((a, b) => {
      const aa = breakStatus(a.b) === "active" ? -1 : 0;
      const bb = breakStatus(b.b) === "active" ? -1 : 0;
      return aa - bb || (a.at ?? 1e9) - (b.at ?? 1e9);
    })
    .slice(0, 8);

  return (
    <div className="section">
      <div className="section-title">
        <h2>Break queue</h2>
        <p>On break now first, then next up. Tap Start when someone leaves, End when they are back.</p>
      </div>
      {!items.length && <div className="card muted">No breaks coming up.</div>}
      <div className="queue">
        {items.map(({ s, b, at }) => {
          const status = breakStatus(b);
          const delta = at == null ? 0 : t - at;
          const cls = status === "active" ? "active" : at == null ? "" : delta > 15 ? "late" : delta >= 0 ? "due" : "";
          const plan = at != null && status !== "active" ? coverFor(day, settings, s, at) : null;
          return (
            <div className={`q-item ${cls}`} key={b.id}>
              <div className="q-main">
                <strong>
                  {s.name} <span className="muted">· {b.length} min</span>
                </strong>
                <small>
                  {status === "active"
                    ? `Started ${fmt(b.start)} · back ${fmt(b.start! + b.length)}${
                        t - (b.start! + b.length) > 0 ? ` · ${fmtDuration(t - b.start! - b.length)} over` : ` · ${fmtDuration(b.start! + b.length - t)} left`
                      }`
                    : at == null
                      ? "No time planned"
                      : `${delta >= 0 ? (delta > 15 ? "Overdue" : "Due") : "Planned"} ${fmt(at)}${
                          delta < 0 ? ` · in ${fmtDuration(-delta)}` : delta > 0 ? ` · ${fmtDuration(delta)} ago` : ""
                        }`}
                </small>
                {plan && plan.status === "cover" && plan.cover && (
                  <small>
                    Cover {plan.position ? POSITION_LABEL[plan.position] : ""}: {FIRST_NAME(plan.cover.name)}
                  </small>
                )}
                {plan && plan.status === "uncovered" && (
                  <small style={{ color: "var(--danger)" }}>
                    {plan.position ? POSITION_LABEL[plan.position] : "Position"} will be uncovered
                  </small>
                )}
              </div>
              {status === "active" ? (
                <button className="btn primary small" onClick={() => mutate((d) => endBreak(d, s.id, b.id, t))}>
                  End
                </button>
              ) : (
                <button className="btn small" onClick={() => mutate((d) => startBreak(d, s.id, b.id, t))}>
                  Start
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- grid ---------- */

function Grid({ ctx, slots, currentSlot }: { ctx: Ctx; slots: number[]; currentSlot: number | null }) {
  const { day, settings, mutate } = ctx;
  const step = settings.rotationMinutes;

  function setCell(s: Shift, slot: number, value: string) {
    const key = cellKey(s.id, slot);
    if (value === "auto") {
      mutate((d) => {
        const { [key]: _drop, ...rest } = d.cells;
        void _drop;
        return { ...d, cells: rest };
      }, { auto: true });
    } else {
      mutate((d) => ({ ...d, cells: { ...d.cells, [key]: { pos: value as Position, pinned: true } } }), { auto: true });
    }
  }

  return (
    <div className="scroll">
      <table className="grid">
        <thead>
          <tr>
            <th className="who">Team</th>
            {slots.map((slot) => (
              <th key={slot} className={`slot ${slot === currentSlot ? "current" : ""}`}>
                {fmt(slot)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {day.shifts.map((s) => (
            <tr key={s.id}>
              <th className="who" scope="row">
                {s.name || "(no name)"}
                <small>
                  {fmtShort(s.start)}–{fmtShort(s.end)}
                  {s.floater ? " · floater" : ""}
                  {s.lock ? ` · stays ${POSITION_LABEL[s.lock]}` : ""}
                </small>
              </th>
              {slots.map((slot) => {
                if (!isPresent(s, slot, step)) {
                  return (
                    <td key={slot}>
                      <div className="cell-empty" />
                    </td>
                  );
                }
                const cell = day.cells[cellKey(s.id, slot)];
                const breaks = s.breaks.filter((b) => {
                  const a = effectiveStart(b);
                  return a != null && a >= slot && a < slot + step;
                });
                return (
                  <td key={slot}>
                    <div className={`cell ${cell ? `pos-${cell.pos}` : ""} ${cell?.pinned ? "pinned" : ""} ${slot === currentSlot ? "current" : ""}`}>
                      <select
                        aria-label={`${s.name} at ${fmt(slot)}`}
                        value={cell?.pos ?? ""}
                        onChange={(e) => setCell(s, slot, e.target.value)}
                      >
                        {!cell && <option value="">—</option>}
                        {POSITIONS.map((p) => (
                          <option key={p} value={p}>
                            {POSITION_LABEL[p]}
                          </option>
                        ))}
                        {cell?.pinned && <option value="auto">Auto (unpin)</option>}
                      </select>
                      {cell?.pinned && <span className="pin" aria-hidden />}
                      {breaks.length > 0 && (
                        <div className="chips">
                          {breaks.map((b) => {
                            const st = breakStatus(b);
                            return (
                              <span key={b.id} className={`chip ${st === "done" ? "done" : st === "active" ? "active" : ""}`}>
                                ☕ {fmtShort(effectiveStart(b))} · {b.length}m
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Coverage({ ctx, slots, currentSlot }: { ctx: Ctx; slots: number[]; currentSlot: number | null }) {
  const { day, settings } = ctx;
  const step = settings.rotationMinutes;
  return (
    <div className="scroll">
      <table className="grid">
        <thead>
          <tr>
            <th className="who">Position</th>
            {slots.map((slot) => (
              <th key={slot} className={`slot ${slot === currentSlot ? "current" : ""}`}>
                {fmt(slot)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {POSITIONS.map((p) => (
            <tr key={p} className={`pos-${p}`}>
              <th className="who" scope="row" style={{ color: "var(--pos)" }}>
                {POSITION_LABEL[p]}
              </th>
              {slots.map((slot) => {
                const present = day.shifts.filter((s) => isPresent(s, slot, step));
                const names = present.filter((s) => day.cells[cellKey(s.id, slot)]?.pos === p);
                const cls = !present.length ? "none" : names.length ? "" : "open";
                return (
                  <td key={slot} className={`cov ${cls}`}>
                    {!present.length ? "·" : names.length ? names.map((s) => FIRST_NAME(s.name)).join(", ") : "OPEN"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fairness({ ctx }: { ctx: Ctx }) {
  const { day, settings } = ctx;
  const mins = positionMinutes(day, settings);
  const longest = Math.max(1, ...day.shifts.map((s) => POSITIONS.reduce((n, p) => n + mins[s.id][p], 0)));
  return (
    <div className="card fair">
      {day.shifts.map((s) => {
        const m = mins[s.id];
        return (
          <div key={s.id} style={{ display: "contents" }}>
            <div>
              <strong>{s.name || "(no name)"}</strong>
              {s.lock && <span className="badge" style={{ marginLeft: 8 }}>Stays</span>}
            </div>
            <div className="bar-track" style={{ width: `${(POSITIONS.reduce((n, p) => n + m[p], 0) / longest) * 100}%`, minWidth: 40 }}>
              {POSITIONS.map((p) =>
                m[p] > 0 ? (
                  <div key={p} className={`bar-seg pos-${p}`} style={{ flex: m[p] }} title={`${POSITION_LABEL[p]} ${fmtDuration(m[p])}`}>
                    {fmtDuration(m[p])}
                  </div>
                ) : null,
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
