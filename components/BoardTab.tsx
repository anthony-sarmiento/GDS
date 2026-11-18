"use client";

import { useEffect, useRef, useState } from "react";
import { Ctx, FIRST_NAME } from "./ctx";
import { Position, POSITIONS, POSITION_LABEL, Shift } from "@/lib/types";
import { breakStatus, effectiveStart } from "@/lib/breaks";
import {
  breakAtCell,
  breakImpact,
  cellAt,
  cellKey,
  cellsFor,
  isPresent,
  liveFloor,
  positionMinutes,
  staffAt,
  staffStatus,
  suggestCover,
} from "@/lib/rotation";
import { bumpOut, endBreak, eraseCells, paintCells, placeBreak, startBreak } from "@/lib/store";
import { alignAfter, fmt, fmtDuration, fmtShort, fromInput, toInput } from "@/lib/time";

type Brush = "none" | Position | "break" | "erase";

const BRUSHES: { id: Brush; label: string; key: string; cls: string }[] = [
  { id: "front", label: "Front", key: "1", cls: "pos-front" },
  { id: "bar", label: "Bar", key: "2", cls: "pos-bar" },
  { id: "dungeon", label: "Dungeon", key: "3", cls: "pos-dungeon" },
  { id: "break", label: "Break", key: "4", cls: "brush-break" },
  { id: "erase", label: "Erase", key: "0", cls: "brush-erase" },
];

export default function BoardTab({ ctx, goTeam }: { ctx: Ctx; goTeam: () => void }) {
  const { day, settings, now, mutate } = ctx;
  const [bumpFor, setBumpFor] = useState<string | null>(null);

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

  const cells = cellsFor(day.shifts, settings);
  const currentCell = now == null ? null : cellAt(cells, settings.gridMinutes, now);

  return (
    <div>
      {now != null && <NowPanel ctx={ctx} onBump={setBumpFor} />}
      {now != null && <BreakQueue ctx={ctx} />}

      <div className="section-title">
        <h2>Board</h2>
        <p>Pick a position, then click or drag across a row. Painted blocks stay put until you erase them.</p>
        <span className="spacer" />
        <button
          className="btn"
          onClick={() => {
            const from = now ?? -Infinity;
            mutate(
              (d) => ({
                ...d,
                // keep hand-painted blocks; drop everything else from now on so it is dealt again
                cells: Object.fromEntries(
                  Object.entries(d.cells).filter(([k, c]) => c.pinned || Number(k.split("@")[1]) < from),
                ),
              }),
              { auto: "cells" },
            );
            ctx.flash(now != null ? "Re-dealt the rest of the day" : "Board re-dealt");
          }}
        >
          {now != null ? "Auto-deal from now" : "Auto-deal"}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            mutate(
              (d) => ({ ...d, cells: Object.fromEntries(Object.entries(d.cells).map(([k, c]) => [k, { ...c, pinned: false }])) }),
              { auto: "cells" },
            );
            ctx.flash("Cleared all hand-painted blocks and re-dealt");
          }}
        >
          Clear painted
        </button>
      </div>

      <Grid ctx={ctx} cells={cells} currentCell={currentCell} onBump={setBumpFor} />

      <div className="section-title">
        <h2>Coverage</h2>
        <p>
          People on each position per column, breaks excluded. SOP: Front {settings.limits.front.min}–{settings.limits.front.max}, Bar{" "}
          {settings.limits.bar.min}–{settings.limits.bar.max}, Dungeon {settings.limits.dungeon.min}–{settings.limits.dungeon.max}.
        </p>
      </div>
      <Coverage ctx={ctx} cells={cells} currentCell={currentCell} />

      <div className="section-title">
        <h2>Time at each position</h2>
        <p>Breaks excluded. The Bar needs the most seats, so it runs highest.</p>
      </div>
      <Fairness ctx={ctx} />

      {bumpFor && <BumpDialog ctx={ctx} outId={bumpFor} onClose={() => setBumpFor(null)} />}
    </div>
  );
}

/* ---------- live panel ---------- */

function NowPanel({ ctx, onBump }: { ctx: Ctx; onBump: (id: string) => void }) {
  const { day, settings, now } = ctx;
  const t = now!;
  const floor = liveFloor(day, settings, t);
  const onShift = day.shifts.filter((s) => s.start <= t && t < s.end);
  const nextBlock =
    settings.anchor + (Math.floor((t - settings.anchor) / settings.rotationMinutes) + 1) * settings.rotationMinutes;
  const lastEnd = Math.max(...day.shifts.map((s) => s.end));

  return (
    <div className="section">
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>Right now</h2>
        <p>
          {fmt(t)}
          {nextBlock < lastEnd && ` · next auto-rotation block at ${fmt(nextBlock)} (${fmtDuration(nextBlock - t)})`}
        </p>
      </div>
      {onShift.length === 0 && <div className="card muted">Nobody is clocked in at this time.</div>}
      {onShift.length > 0 && (
        <div className="now-grid">
          {POSITIONS.map((p) => {
            const working = floor.byPos[p];
            const out = floor.onBreak.filter((b) => b.pos === p);
            const limit = settings.limits[p];
            const status = staffStatus(working.length, limit);
            const cover = status === "short" || status === "open" ? suggestCover(floor, settings, p) : null;
            return (
              <div key={p} className={`pos-card pos-${p} ${status === "open" ? "open" : status === "short" ? "short" : ""}`}>
                <header>
                  <h3>{POSITION_LABEL[p]}</h3>
                  <span className="muted">
                    {working.length} on · needs {limit.min === limit.max ? limit.min : `${limit.min}–${limit.max}`}
                  </span>
                </header>
                {working.map((s) => (
                  <div className="person" key={s.id}>
                    {s.name}
                    {s.floater && <span className="badge">Floater</span>}
                    {s.lock && <span className="badge">Stays</span>}
                    <small>until {fmtShort(Math.min(s.end, nextBlock))}</small>
                    <button className="btn ghost small" title={`Bump ${s.name} out`} onClick={() => onBump(s.id)}>
                      Bump
                    </button>
                  </div>
                ))}
                {out.map(({ shift, brk }) => (
                  <div className="person out" key={shift.id}>
                    ☕ {shift.name} <small>back ~{fmtShort(brk.start! + brk.length)}</small>
                  </div>
                ))}
                {(status === "open" || status === "short") && (
                  <div className="open-label" style={{ marginTop: 10 }}>
                    {status === "open" ? "Nobody here" : `Short by ${limit.min - working.length}`}
                  </div>
                )}
                {cover && (
                  <div className="person cover">
                    Move {cover.shift.name}
                    <small>from {POSITION_LABEL[cover.from]}</small>
                  </div>
                )}
                {status === "over" && <div className="open-label" style={{ marginTop: 10, color: "var(--warn)" }}>Over the max</div>}
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
        <h2>Break timer</h2>
        <p>On break now first, then next up. Tap Start when someone leaves, End when they are back.</p>
      </div>
      {!items.length && <div className="card muted">No breaks coming up.</div>}
      <div className="queue">
        {items.map(({ s, b, at }) => {
          const status = breakStatus(b);
          const delta = at == null ? 0 : t - at;
          const cls = status === "active" ? "active" : at == null ? "" : delta > 15 ? "late" : delta >= 0 ? "due" : "";
          const impact = at != null && status !== "active" ? breakImpact(day, settings, s, at) : null;
          const backAt = b.start != null ? b.start + b.length : 0;
          return (
            <div className={`q-item ${cls}`} key={b.id}>
              <div className="q-main">
                <strong>
                  {s.name} <span className="muted">· {b.length} min</span>
                </strong>
                <small>
                  {status === "active"
                    ? `Started ${fmt(b.start)} · back ${fmt(backAt)} · ${
                        t > backAt ? `${fmtDuration(t - backAt)} over` : `${fmtDuration(backAt - t)} left`
                      }`
                    : at == null
                      ? "No time planned"
                      : `${delta >= 0 ? (delta > 15 ? "Overdue" : "Due") : "Planned"} ${fmt(at)}${
                          delta < 0 ? ` · in ${fmtDuration(-delta)}` : delta > 0 ? ` · ${fmtDuration(delta)} ago` : ""
                        }`}
                </small>
                {impact && impact.position && impact.status !== "ok" && impact.status !== "unknown" && (
                  <small style={{ color: impact.status === "open" ? "var(--danger)" : "var(--warn)" }}>
                    {POSITION_LABEL[impact.position]} drops to {impact.remaining} (needs {impact.min})
                  </small>
                )}
              </div>
              {status === "active" ? (
                <button className="btn primary small" onClick={() => mutate((d) => endBreak(d, s.id, b.id, t), { auto: "cells" })}>
                  End
                </button>
              ) : (
                <button className="btn small" onClick={() => mutate((d) => startBreak(d, s.id, b.id, t), { auto: "cells" })}>
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

/* ---------- shared header ---------- */

function TimeHeader({ cells, currentCell, first }: { cells: number[]; currentCell: number | null; first: string }) {
  const hours: { hour: number; count: number }[] = [];
  for (const c of cells) {
    const hour = Math.floor(c / 60);
    const last = hours[hours.length - 1];
    if (last && last.hour === hour) last.count += 1;
    else hours.push({ hour, count: 1 });
  }
  return (
    <thead>
      <tr>
        <th className="who" rowSpan={2}>
          {first}
        </th>
        {hours.map((h) => (
          <th key={h.hour} colSpan={h.count} className="hour">
            {fmt(h.hour * 60).replace(":00", "")}
          </th>
        ))}
      </tr>
      <tr>
        {cells.map((c) => (
          <th key={c} className={`minute ${c === currentCell ? "current" : ""}`}>
            {String(((c % 60) + 60) % 60).padStart(2, "0")}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/* ---------- the painted grid ---------- */

type Draft = { shiftId: string; cells: number[] } | null;

function Grid({
  ctx,
  cells,
  currentCell,
  onBump,
}: {
  ctx: Ctx;
  cells: number[];
  currentCell: number | null;
  onBump: (id: string) => void;
}) {
  const { day, settings, mutate, flash } = ctx;
  const g = settings.gridMinutes;
  const [brush, setBrush] = useState<Brush>("none");
  const [draft, setDraft] = useState<Draft>(null);
  const drag = useRef<{ shiftId: string; first: number; touch: boolean } | null>(null);
  const live = useRef({ ctx, brush, cells });
  live.current = { ctx, brush, cells };

  // keyboard: 1-4 pick a brush, 0 erase, Esc to put the brush down
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") setBrush("none");
      const hit = BRUSHES.find((b) => b.key === e.key);
      if (hit) setBrush((cur) => (cur === hit.id ? "none" : hit.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // finish a paint stroke anywhere on the page
  useEffect(() => {
    const range = (shiftId: string, a: number, b: number) => {
      const { cells: cs, ctx: c } = live.current;
      const s = c.day.shifts.find((x) => x.id === shiftId);
      if (!s) return [];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return cs.filter((x) => x >= lo && x <= hi && isPresent(s, x, c.settings.gridMinutes));
    };

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.touch) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-cell]");
      if (!el) return;
      const [sid, cs] = (el.dataset.cell ?? "").split("|");
      if (sid !== d.shiftId) return;
      setDraft({ shiftId: sid, cells: range(sid, d.first, Number(cs)) });
    };

    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      setDraft((cur) => {
        if (d && cur && cur.cells.length) apply(d.shiftId, cur.cells);
        return null;
      });
    };
    const onCancel = () => {
      drag.current = null;
      setDraft(null);
    };

    function apply(shiftId: string, picked: number[]) {
      const { ctx: c, brush: b } = live.current;
      const gm = c.settings.gridMinutes;
      const sorted = [...picked].sort((x, y) => x - y);
      if (b === "none") return;
      if (b === "erase") {
        c.mutate((d) => eraseCells(d, c.settings, shiftId, sorted), { auto: "cells" });
      } else if (b === "break") {
        const span = sorted.length > 1 ? sorted[sorted.length - 1] + gm - sorted[0] : null;
        c.mutate((d) => placeBreak(d, c.settings, shiftId, sorted[0], span), { auto: "cells" });
      } else {
        c.mutate((d) => paintCells(d, shiftId, sorted, b), { auto: "fill" });
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  function down(e: React.PointerEvent, shiftId: string, c: number) {
    if (brush === "none") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType !== "touch") e.preventDefault();
    drag.current = { shiftId, first: c, touch: e.pointerType === "touch" };
    setDraft({ shiftId, cells: [c] });
  }

  const brushDef = BRUSHES.find((b) => b.id === brush);

  return (
    <div>
      <div className="palette no-print" role="toolbar" aria-label="Brush">
        <span className="muted">Brush</span>
        {BRUSHES.map((b) => (
          <button
            key={b.id}
            className={`brush ${b.cls}`}
            aria-pressed={brush === b.id}
            onClick={() => setBrush(brush === b.id ? "none" : b.id)}
            title={`${b.label} (press ${b.key})`}
          >
            <kbd>{b.key}</kbd>
            {b.label}
          </button>
        ))}
        <span className="muted palette-hint">
          {brush === "none" && "Pick a brush to start. Esc puts it down."}
          {brush === "break" && "Click a column to put a break there. Drag across columns to set its length."}
          {brush === "erase" && "Click or drag to clear painted blocks and take breaks off the board."}
          {(brush === "front" || brush === "bar" || brush === "dungeon") && `Click or drag across a row to put people on ${POSITION_LABEL[brush]}.`}
        </span>
      </div>

      <div className={`scroll board ${brush !== "none" ? "painting" : ""}`} data-brush={brushDef?.id}>
        <table className="grid tight">
          <TimeHeader cells={cells} currentCell={currentCell} first="Team" />
          <tbody>
            {day.shifts.map((s) => {
              const states = cells.map((c) => {
                if (!isPresent(s, c, g)) return { kind: "absent" as const };
                const brk = breakAtCell(s, c, g);
                if (brk) return { kind: "break" as const, brk };
                const cell = day.cells[cellKey(s.id, c)];
                return cell ? { kind: "pos" as const, pos: cell.pos, pinned: cell.pinned } : { kind: "none" as const };
              });
              const same = (i: number, j: number) => {
                const a = states[i];
                const b = states[j];
                if (!a || !b || a.kind !== b.kind) return false;
                if (a.kind === "pos" && b.kind === "pos") return a.pos === b.pos && a.pinned === b.pinned;
                if (a.kind === "break" && b.kind === "break") return a.brk.id === b.brk.id;
                return a.kind === "none";
              };
              const canBump = s.end > (ctx.now ?? s.start);
              return (
                <tr key={s.id}>
                  <th className="who" scope="row">
                    <div className="who-line">
                      <span>{s.name || "(no name)"}</span>
                      {canBump && (
                        <button className="btn ghost small bump" onClick={() => onBump(s.id)} title="Send home / hand off to the next shift">
                          Bump out
                        </button>
                      )}
                    </div>
                    <small>
                      {fmtShort(s.start)}–{fmtShort(s.end)}
                      {s.floater ? " · floater" : ""}
                      {s.lock ? ` · stays ${POSITION_LABEL[s.lock]}` : ""}
                      {s.sentHomeAt != null ? ` · sent home${s.bumpedBy ? `, ${FIRST_NAME(s.bumpedBy)} took over` : ""}` : ""}
                    </small>
                  </th>
                  {cells.map((c, i) => {
                    const st = states[i];
                    const inDraft = draft?.shiftId === s.id && draft.cells.includes(c);
                    const start = !same(i - 1, i);
                    const end = !same(i, i + 1);
                    const edge = `${start ? "run-start" : ""} ${end ? "run-end" : ""}`;
                    let inner: React.ReactNode = <div className="cell-empty" />;
                    if (st.kind === "pos") {
                      inner = (
                        <div className={`tile pos-${st.pos} ${edge} ${st.pinned ? "pinned" : ""}`}>
                          {start && <span className="tile-label">{POSITION_LABEL[st.pos]}</span>}
                          {start && st.pinned && <i className="pin" aria-hidden />}
                        </div>
                      );
                    } else if (st.kind === "break") {
                      const bs = breakStatus(st.brk);
                      inner = (
                        <div className={`tile tile-break ${bs} ${edge}`} title={`${s.name}: ${st.brk.length} min break`}>
                          {start && (
                            <span className="tile-label">
                              {bs === "active" ? "ON BREAK" : bs === "done" ? "✓ Break" : `☕ ${fmtShort(effectiveStart(st.brk))}`}
                            </span>
                          )}
                        </div>
                      );
                    } else if (st.kind === "none") {
                      inner = <div className="tile tile-none" />;
                    }
                    return (
                      <td
                        key={c}
                        data-cell={st.kind === "absent" ? undefined : `${s.id}|${c}`}
                        className={`${c === currentCell ? "current" : ""} ${inDraft ? "draft" : ""} ${((c % 60) + 60) % 60 === 0 ? "hour-edge" : ""}`}
                        onPointerDown={st.kind === "absent" ? undefined : (e) => down(e, s.id, c)}
                      >
                        {inner}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="legend" style={{ marginTop: 10 }}>
        {POSITIONS.map((p) => (
          <span key={p} className={`pos-${p}`}>
            <i />
            {POSITION_LABEL[p]}
          </span>
        ))}
        <span>
          <i style={{ background: "var(--break)" }} />
          Break (green = on break now)
        </span>
        <span>● painted by hand</span>
        <button className="btn ghost small" onClick={() => flash("Tip: keys 1–4 pick a brush, 0 erases, Esc puts it down")}>
          Shortcuts
        </button>
      </div>
    </div>
  );
}

/* ---------- coverage ---------- */

function Coverage({ ctx, cells, currentCell }: { ctx: Ctx; cells: number[]; currentCell: number | null }) {
  const { day, settings } = ctx;
  const g = settings.gridMinutes;
  return (
    <div className="scroll board">
      <table className="grid tight">
        <TimeHeader cells={cells} currentCell={currentCell} first="Position" />
        <tbody>
          {POSITIONS.map((p) => (
            <tr key={p} className={`pos-${p}`}>
              <th className="who" scope="row" style={{ color: "var(--pos)" }}>
                {POSITION_LABEL[p]}
                <small>
                  {settings.limits[p].min === settings.limits[p].max
                    ? `exactly ${settings.limits[p].min}`
                    : `${settings.limits[p].min}–${settings.limits[p].max}`}
                </small>
              </th>
              {cells.map((c) => {
                const anyone = day.shifts.some((s) => isPresent(s, c, g));
                const names = staffAt(day, settings, c)[p];
                const st = staffStatus(names.length, settings.limits[p]);
                return (
                  <td
                    key={c}
                    className={`cov ${!anyone ? "none" : st} ${c === currentCell ? "current" : ""}`}
                    title={names.map((s) => s.name).join(", ") || "Nobody"}
                  >
                    {anyone ? names.length : "·"}
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
              {s.lock && (
                <span className="badge" style={{ marginLeft: 8 }}>
                  Stays
                </span>
              )}
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

/* ---------- bump out ---------- */

function BumpDialog({ ctx, outId, onClose }: { ctx: Ctx; outId: string; onClose: () => void }) {
  const { day, settings, now, mutate, flash } = ctx;
  const out = day.shifts.find((s) => s.id === outId);
  const [leaver, setLeaver] = useState(outId);
  const leaving = day.shifts.find((s) => s.id === leaver) ?? out;

  // The person who relieves them is whoever clocks in around the time they would leave.
  const relief = day.shifts
    .filter((s) => s.id !== outId && s.sentHomeAt == null && out != null && s.start >= out.end - 60 && s.end > out.end)
    .sort((a, b) => a.start - b.start)[0];
  // default time: now if we have it, otherwise when the relief arrives, otherwise their clock-out
  const [time, setTime] = useState<number>(() => {
    const t = now != null ? Math.max(now, relief?.start ?? now) : (relief?.start ?? out?.end ?? 0);
    return Math.round(t / 15) * 15;
  });
  const [incoming, setIncoming] = useState<string>(relief?.id ?? "");
  const candidates = day.shifts.filter((s) => s.id !== leaver && s.end > time && s.sentHomeAt == null);

  function pickIncoming(id: string) {
    setIncoming(id);
    const inc = day.shifts.find((s) => s.id === id);
    if (inc && inc.start > time) setTime(inc.start);
  }

  if (!out || !leaving) return null;

  function confirm() {
    if (!leaving) return;
    const inc = day.shifts.find((s) => s.id === incoming);
    mutate((d) => bumpOut(d, settings, leaving.id, incoming || null, time), { auto: true });
    flash(`${leaving.name} out at ${fmt(time)}${inc ? ` · ${inc.name} takes over` : ""}`);
    onClose();
  }

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div className="modal card" role="dialog" aria-modal="true" aria-label="Bump out" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 6 }}>Bump out</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Send someone home and hand their position to the next person.
        </p>
        <div className="stack">
          <label className="lbl">
            Sending home
            <select className="field" value={leaver} onChange={(e) => setLeaver(e.target.value)}>
              {day.shifts
                .filter((s) => s.sentHomeAt == null)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({fmtShort(s.start)}–{fmtShort(s.end)})
                  </option>
                ))}
            </select>
          </label>
          <label className="lbl">
            At
            <input
              type="time"
              className="field"
              value={toInput(time)}
              onChange={(e) => {
                const v = fromInput(e.target.value);
                if (v != null) setTime(alignAfter(v, leaving.start));
              }}
            />
          </label>
          <label className="lbl">
            Taking over
            <select className="field" value={incoming} onChange={(e) => pickIncoming(e.target.value)}>
              <option value="">Nobody (just send them home)</option>
              {candidates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — in {fmtShort(s.start)}
                  {s.start > time ? " (arrives later)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirm}>
            Bump out
          </button>
        </div>
      </div>
    </div>
  );
}
