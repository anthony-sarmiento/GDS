"use client";

import { useState } from "react";
import { Ctx } from "./ctx";
import { addCheck, checkRows, checkStats, checkStatus, removeCheck } from "@/lib/checks";
import { alignAfter, fmt, fmtDuration, fromInput, toInput } from "@/lib/time";

/** "1h 25m ago", or "just now" under a minute. */
export const ago = (min: number) => (min < 1 ? "just now" : `${fmtDuration(min)} ago`);

/** Bathroom checks: log one, see how long ago the last was, and look back over the day. */
export default function ChecksTab({ ctx }: { ctx: Ctx }) {
  const { day, settings, now, mutate, flash } = ctx;
  const status = checkStatus(day, settings, now);
  const rows = checkRows(day, settings);
  const stats = checkStats(day);
  const names = day.shifts.map((s) => s.name).filter(Boolean);

  const [time, setTime] = useState<number | null>(null); // null = right now
  const [by, setBy] = useState("");
  const when = time ?? now ?? rows[rows.length - 1]?.check.time ?? day.shifts[0]?.start ?? 0;

  const interval = settings.checkMinutes;
  const pct = status.since == null ? 0 : Math.min(100, (status.since / interval) * 100);
  const state = status.since == null ? "idle" : status.due ? "due" : status.since >= interval * 0.75 ? "soon" : "ok";

  function log() {
    mutate((d) => addCheck(d, when, by), { record: true });
    flash(`Bathroom check logged at ${fmt(when)}${by.trim() ? ` · ${by.trim()}` : ""}`);
    setTime(null);
    setBy("");
  }

  if (!day.shifts.length) {
    return (
      <div className="card empty">
        <h2>No team on this day yet</h2>
      </div>
    );
  }

  return (
    <div className="checks-grid">
      <div>
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>Bathroom checks</h2>
      </div>

      <div className={`card check-card ${state}`}>
        <div className="check-big">
          {status.since == null ? (
            <>
              <span className="check-label">Last check</span>
              <b>{rows.length ? `${fmt(rows[rows.length - 1].check.time)}` : "None yet"}</b>
              <small>Not open right now</small>
            </>
          ) : (
            <>
              <span className="check-label">{status.never ? "No check yet today" : "Last check"}</span>
              <b>{status.never ? `Open for ${fmtDuration(status.since)}` : ago(status.since)}</b>
              <small>
                {status.last
                  ? `${fmt(status.last.time)}${status.last.by ? ` · ${status.last.by}` : ""}`
                  : "Counting from when the store opened"}
                {status.nextAt != null && ` · ${status.due ? "was due" : "next suggested"} ${fmt(status.nextAt)}`}
              </small>
            </>
          )}
        </div>
        {status.since != null && (
          <div className="check-bar" aria-hidden>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}

        <div className="check-form">
          <label className="lbl">
            Time
            <input
              type="time"
              className="field"
              value={toInput(when)}
              onChange={(e) => {
                const v = fromInput(e.target.value);
                if (v != null) setTime(alignAfter(v, day.shifts.reduce((m, s) => Math.min(m, s.start), Infinity)));
              }}
            />
          </label>
          <label className="lbl">
            Done by
            <input
              className="field"
              list="check-names"
              value={by}
              maxLength={24}
              placeholder="Anyone (optional)"
              onChange={(e) => setBy(e.target.value)}
            />
            <datalist id="check-names">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <button className="btn primary" onClick={log}>
            Log check{time == null && now != null ? " now" : ""}
          </button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <b>{stats.count}</b>
          <span>checks today</span>
        </div>
        <div className="stat">
          <b>{stats.average != null ? fmtDuration(stats.average) : "–"}</b>
          <span>average between</span>
        </div>
        <div className="stat">
          <b>{stats.longest != null ? fmtDuration(stats.longest) : "–"}</b>
          <span>longest gap</span>
        </div>
      </div>
      </div>

      <div>
      <div className="section-title">
        <h2>Today&rsquo;s checks</h2>
      </div>
      {rows.length === 0 ? (
        <div className="card muted">No checks logged yet.</div>
      ) : (
        <div className="card check-list">
          {[...rows].reverse().map(({ check, gap, long }, i, all) => {
            const first = i === all.length - 1;
            return (
              <div className="check-row" key={check.id}>
                <b>{fmt(check.time)}</b>
                <span>{check.by || <span className="muted">Anyone</span>}</span>
                <span className={`gap ${long ? "long" : ""}`}>
                  {first ? `${fmtDuration(gap)} after opening` : `+${fmtDuration(gap)}`}
                </span>
                <button
                  className="btn ghost small"
                  aria-label={`Remove the ${fmt(check.time)} check`}
                  onClick={() => mutate((d) => removeCheck(d, check.id))}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
