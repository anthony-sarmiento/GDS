"use client";

import { useEffect, useMemo, useState } from "react";
import { Ctx } from "./ctx";
import { loadHistory } from "@/lib/cloud";
import { breakStatus } from "@/lib/breaks";
import { breakSpan } from "@/lib/rotation";
import { fmt, prettyDate } from "@/lib/time";
import { DayState, Shift } from "@/lib/types";

const breakText = (s: Shift) => {
  const parts = s.breaks
    .map((b) => {
      const sp = breakSpan(b);
      const st = breakStatus(b);
      if (!sp) return null;
      return `${fmt(sp[0])}–${fmt(sp[1])}${st === "done" ? "" : st === "active" ? " (on break)" : " (planned)"}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join(", ") : "no breaks logged";
};

/**
 * Every saved day: who worked, their break log and the bathroom checks. Search by a person's name to see
 * the days they worked. Open a day to see its board.
 */
export default function HistoryTab({ ctx, onOpen }: { ctx: Ctx; onOpen: (date: string) => void }) {
  const [days, setDays] = useState<DayState[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadHistory().then((rows) => {
      if (!cancelled) setDays(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // today's changes may not have reached the database yet, so what is on screen wins
  const merged = useMemo(() => {
    const byDate = new Map<string, DayState>((days ?? []).map((d) => [d.date, d]));
    for (const [d, v] of Object.entries(ctx.state.days)) if (v.shifts.length || (v.checks ?? []).length) byDate.set(d, v);
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [days, ctx.state.days]);

  const needle = q.trim().toLowerCase();
  const rows = merged
    .map((d) => ({ d, people: needle ? d.shifts.filter((s) => s.name.toLowerCase().includes(needle)) : d.shifts }))
    .filter((r) => r.people.length > 0 || (!needle && (r.d.checks ?? []).length > 0));

  return (
    <div>
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>History</h2>
        <span className="spacer" />
        <input
          className="field"
          type="search"
          placeholder="Search a name"
          aria-label="Search history by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {days == null && <div className="card muted">Loading…</div>}
      {days != null && rows.length === 0 && <div className="card muted">{needle ? "No days found for that name." : "No saved days yet."}</div>}

      <div className="stack">
        {rows.map(({ d, people }) => {
          const taken = d.shifts.reduce((n, s) => n + s.breaks.filter((b) => breakStatus(b) === "done").length, 0);
          const total = d.shifts.reduce((n, s) => n + s.breaks.length, 0);
          const checks = (d.checks ?? []).length;
          return (
            <div className="card hist-day" key={d.date}>
              <div className="hist-head">
                <b>{prettyDate(d.date)}</b>
                <span className="muted">
                  {d.shifts.length} people · {taken}/{total} breaks taken · {checks} bathroom check{checks === 1 ? "" : "s"}
                </span>
                <span className="spacer" />
                <button className="btn small" onClick={() => onOpen(d.date)}>
                  Open
                </button>
              </div>
              <div className="hist-people">
                {people.map((s) => (
                  <div key={s.id}>
                    <b style={{ color: "var(--text)" }}>{s.name}</b> {fmt(s.start)}–{fmt(s.end)} · {breakText(s)}
                  </div>
                ))}
                {(d.checks ?? []).length > 0 && !needle && (
                  <div>Bathroom checks: {(d.checks ?? []).map((c) => fmt(c.time)).join(", ")}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
