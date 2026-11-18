"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Ctx, FIRST_NAME } from "./ctx";
import { runBreakChange } from "./breakFlow";
import AssignDialog from "./AssignDialog";
import { Position, POSITIONS, POSITION_LABEL, roleName, Shift } from "@/lib/types";
import { breakStatus, effectiveStart } from "@/lib/breaks";
import { applyBreakChange } from "@/lib/cover";
import {
  breakImpact,
  breakSpan,
  cellsFor,
  coverageRuns,
  isPresent,
  liveFloor,
  positionMinutes,
  positionRuns,
  rotating,
  staffStatus,
  suggestCover,
} from "@/lib/rotation";
import { bumpOut, endBreak, eraseCells, paintCells, placeBreak, startBreak } from "@/lib/store";
import { alignAfter, fmt, fmtDuration, fmtShort, fromInput, toInput } from "@/lib/time";
import { loadLabels, pushLabel, saveLabels } from "@/lib/labels";

type Brush = "none" | Position | "other" | "break" | "erase";

const BRUSHES: { id: Brush; label: string; key: string; cls: string }[] = [
  { id: "front", label: "Front", key: "1", cls: "pos-front" },
  { id: "bar", label: "Bar", key: "2", cls: "pos-bar" },
  { id: "dungeon", label: "Dungeon", key: "3", cls: "pos-dungeon" },
  { id: "other", label: "Custom", key: "5", cls: "pos-other" },
  { id: "break", label: "Break", key: "4", cls: "brush-break" },
  { id: "erase", label: "Erase", key: "0", cls: "brush-erase" },
];

const ZOOMS = [1.5, 2, 3, 4, 6]; // pixels per minute

/** Name shown on a block. */
const blockName = (pos: string, label?: string) =>
  pos === "other" ? label || "Other" : POSITION_LABEL[pos as Position];

/** Phone-sized screen: narrower name column, tighter default zoom. */
function useCompact(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const on = () => setCompact(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return compact;
}

export default function BoardTab({ ctx, goTeam }: { ctx: Ctx; goTeam: () => void }) {
  const { day, now, mutate } = ctx;
  const [bumpFor, setBumpFor] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<{ shiftId?: string; at?: number } | null>(null);
  const crew = rotating(day.shifts);
  const leads = day.shifts.filter((s) => s.role);

  if (!crew.length) {
    return (
      <div className="card empty">
        <h2>Nobody on the board yet</h2>
        <p>
          {leads.length
            ? "Only leads are on today. Leads are not on the rotation, so add the retail team."
            : "Add today's team and GDS will build the rotation and break plan."}
        </p>
        <button className="btn primary" onClick={goTeam}>
          Add team
        </button>
      </div>
    );
  }

  return (
    <div>
      {now != null && <NowPanel ctx={ctx} onBump={setBumpFor} onAssign={(id) => setAssignFor({ shiftId: id })} />}
      {now != null && <BreakQueue ctx={ctx} />}

      <div className="section-title">
        <h2>Board</h2>
        <p>Tap Assign to send someone somewhere at a time, or tap a row. Brushes paint exact ranges by hand.</p>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setAssignFor({})}>
          Assign
        </button>
        <button
          className="btn"
          onClick={() => {
            const from = now ?? -Infinity;
            mutate(
              (d) => ({
                ...d,
                // keep hand-painted blocks and cover blocks; drop the rest from now on so it is dealt again
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
              (d) => ({
                ...d,
                cells: Object.fromEntries(
                  Object.entries(d.cells)
                    .filter(([, c]) => !c.cover)
                    .map(([k, c]) => [k, { ...c, pinned: false }]),
                ),
              }),
              { auto: "cells" },
            );
            ctx.flash("Cleared all hand-painted blocks and re-dealt");
          }}
        >
          Clear painted
        </button>
      </div>

      {leads.length > 0 && (
        <div className="lead-strip">
          {leads.map((s) => (
            <span key={s.id} className="badge">
              {roleName(s) || "Lead"} · {s.name || "?"} · {fmtShort(s.start)}–{fmtShort(s.end)}
            </span>
          ))}
        </div>
      )}

      <Timeline ctx={ctx} onBump={setBumpFor} onAssign={(id, at) => setAssignFor({ shiftId: id, at })} />

      <div className="section-title">
        <h2>Time at each position</h2>
        <p>Breaks excluded. The Bar needs the most seats, so it runs highest.</p>
      </div>
      <Fairness ctx={ctx} />

      {bumpFor && <BumpDialog ctx={ctx} outId={bumpFor} onClose={() => setBumpFor(null)} />}
      {assignFor && (
        <AssignDialog ctx={ctx} shiftId={assignFor.shiftId} at={assignFor.at} onClose={() => setAssignFor(null)} />
      )}
    </div>
  );
}

/* ---------- live panel ---------- */

function NowPanel({ ctx, onBump, onAssign }: { ctx: Ctx; onBump: (id: string) => void; onAssign: (id: string) => void }) {
  const { day, settings, now } = ctx;
  const t = now!;
  const floor = liveFloor(day, settings, t);
  const onShift = rotating(day.shifts).filter((s) => s.start <= t && t < s.end);
  const nextBlock =
    settings.anchor + (Math.floor((t - settings.anchor) / settings.rotationMinutes) + 1) * settings.rotationMinutes;
  const lastEnd = Math.max(...rotating(day.shifts).map((s) => s.end));

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
      {onShift.length > 0 && floor.elsewhere.length > 0 && (
        <div className="card elsewhere">
          <strong>Elsewhere</strong>
          {floor.elsewhere.map(({ shift, label }) => (
            <span key={shift.id} className="badge pos-other">
              {shift.name} · {label}
            </span>
          ))}
        </div>
      )}
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
                    <button className="btn ghost small" title={`Assign ${s.name} somewhere`} onClick={() => onAssign(s.id)}>
                      Assign
                    </button>
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
                {status === "over" && (
                  <div className="open-label" style={{ marginTop: 10, color: "var(--warn)" }}>
                    Over the max
                  </div>
                )}
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
        <p>On break now first, then next up. Start moves a cover onto the position. End when they are back.</p>
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
                  {s.role && (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      {roleName(s)}
                    </span>
                  )}
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
                <button
                  className="btn primary small"
                  onClick={() =>
                    mutate((d) => applyBreakChange(d, settings, (dd) => ({ day: endBreak(dd, s.id, b.id, t), breakId: b.id })), {
                      auto: "fill",
                    })
                  }
                >
                  End
                </button>
              ) : (
                <button
                  className="btn small"
                  onClick={() => runBreakChange(ctx, (d) => ({ day: startBreak(d, s.id, b.id, t), breakId: b.id }))}
                >
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

/* ---------- the timeline ---------- */

interface Drag {
  shiftId: string;
  lane: HTMLElement;
  t0: number;
  t1: number;
}

function Timeline({ ctx, onBump, onAssign }: { ctx: Ctx; onBump: (id: string) => void; onAssign: (id: string, at: number) => void }) {
  const { day, settings, now, flash } = ctx;
  const g = settings.gridMinutes;
  const crew = rotating(day.shifts);

  const compact = useCompact();
  const LABEL_W = compact ? 92 : 200;
  const [brush, setBrush] = useState<Brush>("none");
  const [customLabel, setCustomLabel] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(loadLabels()), []);
  const [ppm, setPpm] = useState(() => (typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches ? 2 : 3));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const live = useRef({ ctx, brush, customLabel });
  live.current = { ctx, brush, customLabel };

  const dayStart = Math.floor(Math.min(...crew.map((s) => s.start)) / 60) * 60;
  const dayEnd = Math.ceil(Math.max(...crew.map((s) => s.end)) / 60) * 60;
  const width = (dayEnd - dayStart) * ppm;
  const X = (t: number) => (t - dayStart) * ppm;
  const range = useRef({ dayStart, dayEnd, ppm });
  range.current = { dayStart, dayEnd, ppm };

  // bring "now" into view, on load and whenever the zoom changes
  const scroller = useRef<HTMLDivElement>(null);
  const nowRef = useRef(now);
  nowRef.current = now;
  const jumpToNow = () => {
    const el = scroller.current;
    const t = nowRef.current;
    if (!el || t == null) return;
    el.scrollTo({ left: Math.max(0, X(t) - (el.clientWidth - LABEL_W) / 2), behavior: "smooth" });
  };
  useEffect(() => {
    const el = scroller.current;
    const t = nowRef.current;
    if (el && t != null) el.scrollLeft = Math.max(0, (t - dayStart) * ppm - (el.clientWidth - LABEL_W) / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ppm, compact]);

  const hours: number[] = [];
  for (let h = dayStart; h < dayEnd; h += 60) hours.push(h);

  // keys: 1-4 pick a brush, 0 erases, Esc puts the brush down
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") setBrush("none");
      const hit = BRUSHES.find((b) => b.key === e.key);
      if (hit) {
        e.preventDefault(); // otherwise the key is typed into the custom-name box that opens
        setBrush((cur) => (cur === hit.id ? "none" : hit.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // painting: the stroke is tracked on the window so it never gets lost
  useEffect(() => {
    const minuteAt = (e: { clientX: number }, lane: HTMLElement) => {
      const { dayStart: ds, dayEnd: de, ppm: p } = range.current;
      const x = e.clientX - lane.getBoundingClientRect().left;
      const t = ds + Math.floor(x / p / g) * g;
      return Math.max(ds, Math.min(de - g, t));
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const t1 = minuteAt(e, d.lane);
      if (t1 !== d.t1) {
        dragRef.current = { ...d, t1 };
        setDrag(dragRef.current);
      }
    };

    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (d) apply(d);
    };
    const onCancel = () => {
      dragRef.current = null;
      setDrag(null);
    };

    function apply(d: Drag) {
      const { ctx: c, brush: b, customLabel: label } = live.current;
      const day2 = c.day;
      const shift = day2.shifts.find((s) => s.id === d.shiftId);
      if (!shift || b === "none") return;
      const gm = c.settings.gridMinutes;
      const moved = d.t0 !== d.t1;
      const lo = Math.min(d.t0, d.t1);
      const hi = Math.max(d.t0, d.t1) + gm;
      const crewCells = cellsFor(day2.shifts, c.settings);
      const cellsIn = (a: number, z: number) => crewCells.filter((x) => x + gm > a && x < z && isPresent(shift, x, gm));

      // the merged block under the click, so a plain click repaints the whole block
      const { runs } = positionRuns(day2, c.settings, shift);
      const run = runs.find((r) => r.start <= d.t0 && d.t0 < r.end);

      if (b === "break") {
        const length = moved ? hi - lo : null;
        runBreakChange(c, (dd) => placeBreak(dd, shift.id, moved ? lo : d.t0, length));
      } else if (b === "erase") {
        const hit = shift.breaks.find((br) => {
          const sp = breakSpan(br);
          return br.start == null && sp && sp[0] <= d.t0 && d.t0 < sp[1];
        });
        const sp = hit ? breakSpan(hit) : null;
        const targets = moved ? cellsIn(lo, hi) : sp ? cellsIn(sp[0], sp[1]) : run ? cellsIn(run.start, run.end) : [];
        if (targets.length) c.mutate((dd) => eraseCells(dd, c.settings, shift.id, targets), { auto: "fill" });
      } else {
        const targets = moved ? cellsIn(lo, hi) : run ? cellsIn(run.start, run.end) : [];
        if (targets.length) {
          const name = b === "other" ? label.trim() : "";
          c.mutate((dd) => paintCells(dd, shift.id, targets, b, name), { auto: "fill" });
          if (name) {
            setRecent((cur) => {
              const next = pushLabel(cur, name);
              saveLabels(next);
              return next;
            });
          }
        }
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
  }, [g]);

  // Pan mode: a tap (not a scroll or drag) on a row starts an assignment from that time
  const tapRef = useRef<{ id: string; x: number; y: number } | null>(null);
  function tap(e: React.MouseEvent<HTMLDivElement>, shift: Shift) {
    const t0 = tapRef.current;
    tapRef.current = null;
    if (brush !== "none" || !t0 || t0.id !== shift.id) return;
    if (Math.abs(e.clientX - t0.x) > 6 || Math.abs(e.clientY - t0.y) > 6) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const t = dayStart + Math.floor(x / ppm / g) * g;
    if (t < shift.start - g || t >= shift.end) return;
    onAssign(shift.id, Math.max(t, shift.start));
  }

  function down(e: React.PointerEvent<HTMLDivElement>, shift: Shift) {
    if (brush === "none") {
      tapRef.current = { id: shift.id, x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const lane = e.currentTarget;
    // keep the stroke attached to this row even if the pointer wanders off it
    try {
      lane.setPointerCapture(e.pointerId);
    } catch {
      /* not every browser allows it; the window listeners still cover the stroke */
    }
    const x = e.clientX - lane.getBoundingClientRect().left;
    const t = Math.max(dayStart, Math.min(dayEnd - g, dayStart + Math.floor(x / ppm / g) * g));
    const d = { shiftId: shift.id, lane, t0: t, t1: t };
    dragRef.current = d;
    setDrag(d);
  }

  function track(e: React.PointerEvent<HTMLDivElement>) {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left - LABEL_W;
    const t = dayStart + Math.floor(x / ppm / g) * g;
    const next = t >= dayStart && t < dayEnd ? t : null;
    if (next !== hover) setHover(next);
  }

  const brushDef = BRUSHES.find((b) => b.id === brush);
  const dragLo = drag ? Math.min(drag.t0, drag.t1) : 0;
  const dragHi = drag ? Math.max(drag.t0, drag.t1) + g : 0;

  const coverage = useMemo(
    () => POSITIONS.map((p) => ({ p, runs: coverageRuns(day, settings, p) })),
    [day, settings],
  );

  return (
    <div>
      <div className="palette no-print" role="toolbar" aria-label="Brush">
        <button
          className="brush brush-pan"
          aria-pressed={brush === "none"}
          onClick={() => setBrush("none")}
          title="Scroll and look without painting (Esc)"
        >
          Pan
        </button>
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
        <span style={{ flex: 1 }} />
        {now != null && (
          <button className="btn small" onClick={jumpToNow} title="Scroll to the current time">
            Now
          </button>
        )}
      </div>
      {brush === "other" && (
        <div className="custom-row no-print">
          <input
            className="field"
            value={customLabel}
            maxLength={24}
            placeholder="Type a position, e.g. Tournament"
            aria-label="Custom position name"
            onChange={(e) => setCustomLabel(e.target.value)}
            autoFocus
          />
          {recent.length > 0 && (
            <div className="chip-row">
              {recent.map((r) => (
                <button
                  key={r}
                  className="btn small"
                  aria-pressed={customLabel.trim().toLowerCase() === r.toLowerCase()}
                  onClick={() => setCustomLabel(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="board-sub">
      <p className="muted palette-hint" style={{ margin: 0 }}>
        {brush === "none" &&
          (compact
            ? "Tap a row to assign from that time, or tap a name. Pick a brush to paint ranges by hand."
            : "Click a row to assign someone from that time, or click a name. Pick a brush (keys 1–5, 0 to erase) to paint ranges by hand.")}
        {brush === "break" &&
          "Drag across a row to set the break's exact start and end. A click puts the break at that minute using its normal length."}
        {brush === "erase" && "Click a block to clear it, or drag for an exact range. Click a break to take it off the board."}
        {(brush === "front" || brush === "bar" || brush === "dungeon") &&
          `Drag across a row for an exact range on ${POSITION_LABEL[brush]}. Click a block to repaint all of it.`}
        {brush === "other" &&
          "Type a name above, then drag across a row. Custom blocks are not counted as Front, Bar or Dungeon, so coverage will show the gap."}
        {compact && brush !== "none" && " Tap Pan to scroll the board."}
      </p>
        <div className="zoom-group" role="group" aria-label="Zoom">
          <span className="muted zoom-label">Zoom</span>
          <button
            className="btn small"
            disabled={ppm === ZOOMS[0]}
            onClick={() => setPpm(ZOOMS[Math.max(0, ZOOMS.indexOf(ppm) - 1)])}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            className="btn small"
            disabled={ppm === ZOOMS[ZOOMS.length - 1]}
            onClick={() => setPpm(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(ppm) + 1)])}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div ref={scroller} className={`scroll board ${brush !== "none" ? "painting" : ""}`} data-brush={brushDef?.id}>
        <div
          className="tl"
          style={{ width: LABEL_W + width, ["--ppm" as string]: ppm, ["--label" as string]: `${LABEL_W}px` }}
          onPointerMove={track}
          onPointerLeave={() => setHover(null)}
        >
          {/* time ruler */}
          <div className="tl-row tl-head">
            <div className="tl-label">
              <span className="muted">{hover != null ? fmt(hover) : "Team"}</span>
            </div>
            <div className="tl-lane ruler" style={{ width }}>
              {hours.map((h) => (
                <div key={h} className="tick hour" style={{ left: X(h) }}>
                  {fmt(h).replace(":00", "")}
                </div>
              ))}
              {ppm >= 3 &&
                hours.flatMap((h) =>
                  [15, 30, 45].map((m) => (
                    <div key={h + m} className="tick quarter" style={{ left: X(h + m) }}>
                      :{m}
                    </div>
                  )),
                )}
            </div>
          </div>

          {crew.map((s) => {
            const { runs, pins } = positionRuns(day, settings, s);
            const inDrag = drag?.shiftId === s.id;
            return (
              <div className="tl-row" key={s.id}>
                <div className="tl-label">
                  <div className="who-line">
                    <button
                      className="who-name link"
                      onClick={() => onAssign(s.id, Math.max(s.start, now ?? s.start))}
                      title={`Assign ${s.name} somewhere`}
                    >
                      {s.name || "(no name)"}
                    </button>
                    {s.end > (now ?? s.start) && (
                      <button
                        className="btn ghost small bump"
                        onClick={() => onBump(s.id)}
                        title="Send home / hand off to the next shift"
                        aria-label={`Bump ${s.name} out`}
                      >
                        {compact ? "⋯" : "Bump out"}
                      </button>
                    )}
                  </div>
                  <small>
                    {fmtShort(s.start)}–{fmtShort(s.end)}
                    {s.floater ? " · floater" : ""}
                    {s.lock ? ` · stays ${POSITION_LABEL[s.lock]}` : ""}
                    {s.sentHomeAt != null ? ` · sent home${s.bumpedBy ? `, ${FIRST_NAME(s.bumpedBy)} took over` : ""}` : ""}
                  </small>
                </div>
                <div className="tl-lane" style={{ width }} onPointerDown={(e) => down(e, s)} onClick={(e) => tap(e, s)}>
                  <div className="off" style={{ left: 0, width: Math.max(0, X(s.start)) }} />
                  <div className="off" style={{ left: X(s.end), width: Math.max(0, width - X(s.end)) }} />

                  {runs.map((r) => (
                    <div
                      key={`${r.pos}-${r.start}`}
                      className={`blk pos-${r.pos}`}
                      style={{ left: X(r.start), width: (r.end - r.start) * ppm }}
                      title={`${s.name}: ${blockName(r.pos, r.label)} ${fmt(r.start)}–${fmt(r.end)}`}
                    >
                      <span className="blk-label">
                        {(r.end - r.start) * ppm > 46 ? blockName(r.pos, r.label) : blockName(r.pos, r.label)[0]}
                      </span>
                    </div>
                  ))}
                  {pins.map(([a, z]) => (
                    <div key={`pin-${a}`} className="pin-strip" style={{ left: X(a), width: (z - a) * ppm }} />
                  ))}

                  {s.breaks.map((b) => {
                    const sp = breakSpan(b);
                    if (!sp) return null;
                    const st = breakStatus(b);
                    const w = (sp[1] - sp[0]) * ppm;
                    return (
                      <div
                        key={b.id}
                        className={`blk brk ${st}`}
                        style={{ left: X(sp[0]), width: w }}
                        title={`${s.name}: ${b.length} min break ${fmt(sp[0])}–${fmt(sp[1])}`}
                      >
                        <span className="blk-label">
                          {st === "active"
                            ? "ON BREAK"
                            : st === "done"
                              ? "✓"
                              : w > 96
                                ? `☕ ${fmtShort(sp[0])}–${fmtShort(sp[1])}`
                                : w > 40
                                  ? `☕ ${fmtShort(sp[0])}`
                                  : "☕"}
                        </span>
                      </div>
                    );
                  })}

                  {inDrag && (
                    <div className={`blk draft ${brushDef?.cls ?? ""}`} style={{ left: X(dragLo), width: (dragHi - dragLo) * ppm }}>
                      <span className="draft-tip">
                        {fmt(dragLo)}–{fmt(dragHi)} · {dragHi - dragLo}m
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* coverage lives in the same scroll area so it lines up with the rows above */}
          <div className="tl-row tl-sub">
            <div className="tl-label">
              <strong>Coverage</strong>
              <small className="hide-compact">People on each position</small>
            </div>
            <div className="tl-lane sub" style={{ width }} />
          </div>
          {coverage.map(({ p, runs }) => (
            <div className={`tl-row pos-${p}`} key={p}>
              <div className="tl-label">
                <span className="who-name" style={{ color: "var(--pos)" }}>
                  {POSITION_LABEL[p]}
                </span>
                <small>
                  {settings.limits[p].min === settings.limits[p].max
                    ? `exactly ${settings.limits[p].min}`
                    : `${settings.limits[p].min}–${settings.limits[p].max}`}
                </small>
              </div>
              <div className="tl-lane cov-lane" style={{ width }}>
                {runs.map((r) => (
                  <div
                    key={r.start}
                    className={`cov-blk ${r.status}`}
                    style={{ left: X(r.start), width: (r.end - r.start) * ppm }}
                    title={`${POSITION_LABEL[p]}: ${r.count} from ${fmt(r.start)} to ${fmt(r.end)}`}
                  >
                    {r.status === "none" ? "" : r.count}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* now + hover lines */}
          {now != null && now >= dayStart && now <= dayEnd && (
            <div className="now-line" style={{ left: LABEL_W + X(now) }} />
          )}
          {hover != null && !drag && <div className="hover-line" style={{ left: LABEL_W + X(hover) }} />}
        </div>
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
        <span>
          <i style={{ background: "var(--text)", height: 3, marginTop: 4 }} />
          Painted by hand
        </span>
        <button
          className="btn ghost small"
          onClick={() => flash("Keys: 1 Front · 2 Bar · 3 Dungeon · 4 Break · 0 Erase · Esc put the brush down")}
        >
          Shortcuts
        </button>
      </div>
    </div>
  );
}

function Fairness({ ctx }: { ctx: Ctx }) {
  const { day, settings } = ctx;
  const crew = rotating(day.shifts);
  const mins = positionMinutes(day, settings);
  const longest = Math.max(1, ...crew.map((s) => POSITIONS.reduce((n, p) => n + mins[s.id][p], 0)));
  return (
    <div className="card fair">
      {crew.map((s) => {
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
            <div
              className="bar-track"
              style={{ width: `${(POSITIONS.reduce((n, p) => n + m[p], 0) / longest) * 100}%`, minWidth: 40 }}
            >
              {POSITIONS.map((p) =>
                m[p] > 0 ? (
                  <div
                    key={p}
                    className={`bar-seg pos-${p}`}
                    style={{ flex: m[p] }}
                    title={`${POSITION_LABEL[p]} ${fmtDuration(m[p])}`}
                  >
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
  const crew = rotating(day.shifts);
  const out = crew.find((s) => s.id === outId);
  const [leaver, setLeaver] = useState(outId);
  const leaving = crew.find((s) => s.id === leaver) ?? out;

  // The person who relieves them is whoever clocks in around the time they would leave.
  const relief = crew
    .filter((s) => s.id !== outId && s.sentHomeAt == null && out != null && s.start >= out.end - 60 && s.end > out.end)
    .sort((a, b) => a.start - b.start)[0];
  // default time: now if we have it, otherwise when the relief arrives, otherwise their clock-out
  const [time, setTime] = useState<number>(() => {
    const t = now != null ? Math.max(now, relief?.start ?? now) : (relief?.start ?? out?.end ?? 0);
    return Math.round(t / 5) * 5;
  });
  const [incoming, setIncoming] = useState<string>(relief?.id ?? "");
  const candidates = crew.filter((s) => s.id !== leaver && s.end > time && s.sentHomeAt == null);

  function pickIncoming(id: string) {
    setIncoming(id);
    const inc = crew.find((s) => s.id === id);
    if (inc && inc.start > time) setTime(inc.start);
  }

  if (!out || !leaving) return null;

  function confirm() {
    if (!leaving) return;
    const inc = crew.find((s) => s.id === incoming);
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
              {crew
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
