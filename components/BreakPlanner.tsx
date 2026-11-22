"use client";

import { useMemo, useState } from "react";
import { Ctx } from "./ctx";
import { breakStatus } from "@/lib/breaks";
import { planFromPreferences } from "@/lib/plan";
import { updateBreak } from "@/lib/store";
import { fmt, fmtDuration } from "@/lib/time";
import TimeSelect from "./TimeSelect";
import { POSITION_LABEL, roleName, Shift } from "@/lib/types";

/**
 * Before the shift: the lead asks everyone when they would like their break and types it in here.
 * "Plan breaks" then lays the day out around those times and shows the result before anything
 * is put on the board.
 */
export default function BreakPlanner({ ctx }: { ctx: Ctx }) {
  const { day, settings, mutate, flash } = ctx;
  const [open, setOpen] = useState(false);

  const rows = [...day.shifts]
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name))
    .flatMap((s) => s.breaks.map((b) => ({ s, b })));
  const asked = rows.filter(({ b }) => b.start == null && b.preferred != null).length;

  const plan = useMemo(() => (open ? planFromPreferences(day, settings) : null), [open, day, settings]);

  function ask(s: Shift, breakId: string, m: number | null) {
    mutate((d) => updateBreak(d, s.id, breakId, { preferred: m }));
  }

  return (
    <div className="card screen-only planner" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>Break times they asked for</h2>
        <span className="spacer" />
        <button className="btn primary" disabled={asked === 0} onClick={() => setOpen(true)}>
          Plan breaks
        </button>
      </div>

      <div className="pref-grid">
        {rows.map(({ s, b }) => {
          const status = breakStatus(b);
          const taken = status === "done" || status === "active";
          return (
            <div className="pref-row" key={b.id}>
              <span className="pref-name">
                {s.name || "(no name)"}
                {s.role && <small>{roleName(s)}</small>}
              </span>
              <span className="muted">{b.length >= 30 ? "30–60" : b.length} min</span>
              {taken ? (
                <span className="muted">{status === "active" ? "On break" : "Taken"}</span>
              ) : (
                <TimeSelect
                  className="field compact"
                  value={b.preferred ?? null}
                  min={s.start}
                  max={s.end - b.length}
                  empty="No time"
                  label={`Break time ${s.name} asked for`}
                  onChange={(m) => ask(s, b.id, m)}
                />
              )}
              <span className={`pref-placed ${b.planned != null && b.preferred != null && b.planned !== b.preferred ? "off" : ""}`}>
                {!taken && b.planned != null ? `On board ${fmt(b.planned)}` : ""}
              </span>
            </div>
          );
        })}
      </div>

      {open && plan && (
        <div className="modal-back" onClick={() => setOpen(false)} role="presentation">
          <div className="modal card assign" role="dialog" aria-modal="true" aria-label="Plan breaks" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 10 }}>Plan breaks</h2>
            <div className="plan-list">
              {plan.items.map((i) => (
                <div className={`plan-item ${i.moved === 0 ? "" : "moved"}`} key={i.breakId}>
                  <b>{i.name}</b>
                  <span>
                    {fmt(i.placed)}
                    {i.moved !== 0 && (
                      <small>
                        {" "}
                        asked {fmt(i.preferred)} ({i.moved > 0 ? "+" : "−"}
                        {fmtDuration(Math.abs(i.moved))})
                      </small>
                    )}
                  </span>
                  <span className={`plan-cover ${i.short ? "warn" : ""}`}>
                    {i.coverName ? `${i.coverName} covers` : ""}
                    {i.short ? `${i.coverName ? " · " : ""}${i.position ? POSITION_LABEL[i.position] : "Position"} runs short` : ""}
                  </span>
                </div>
              ))}
              {plan.items.length === 0 && <div className="muted">Nothing to plan.</div>}
            </div>
            <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={plan.items.length === 0}
                onClick={() => {
                  mutate((d) => planFromPreferences(d, settings).day, { auto: true });
                  flash(`Planned ${plan.items.length} break${plan.items.length === 1 ? "" : "s"}`);
                  setOpen(false);
                }}
              >
                Put on the board
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
