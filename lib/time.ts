export const DAY = 1440;

const pad = (n: number) => String(n).padStart(2, "0");

/** 810 -> "1:30 PM". Handles values past midnight (1470 -> "12:30 AM"). */
export function fmt(min: number | null | undefined): string {
  if (min == null) return "";
  const m = ((Math.round(min) % DAY) + DAY) % DAY;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(mm)} ${h < 12 ? "AM" : "PM"}`;
}

/** Compact form for tight cells: "1:30p", "5p". */
export function fmtShort(min: number | null | undefined): string {
  if (min == null) return "";
  const m = ((Math.round(min) % DAY) + DAY) % DAY;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? ":" + pad(mm) : ""}${h < 12 ? "a" : "p"}`;
}

/** Minutes -> value for <input type="time"> ("13:30"). */
export function toInput(min: number | null | undefined): string {
  if (min == null) return "";
  const m = ((Math.round(min) % DAY) + DAY) % DAY;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** <input type="time"> value -> minutes since midnight, or null if empty. */
export function fromInput(v: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(v);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Make `value` a time on or after `ref` (used for after-midnight times). */
export function alignAfter(value: number, ref: number): number {
  let v = value;
  while (v < ref) v += DAY;
  return v;
}

/** A clock-out at or before the clock-in means the shift runs past midnight. */
export function normalizeEnd(start: number, end: number): number {
  return end <= start ? end + DAY : end;
}

export function hoursOf(start: number, end: number): number {
  return (end - start) / 60;
}

export function fmtHours(h: number): string {
  const r = Math.round(h * 100) / 100;
  return `${Number.isInteger(r) ? r : r.toFixed(2).replace(/0$/, "")} hrs`;
}

export function fmtDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** YYYY-MM-DD in local time. */
export function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return dateStr(new Date(y, m - 1, d + delta));
}

export function prettyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Before 4 AM still counts as the previous business day. */
const DAY_ROLLOVER_HOUR = 4;

export function operatingDate(now: Date): string {
  const d = new Date(now);
  if (d.getHours() < DAY_ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
  return dateStr(d);
}

/** Minutes on the operating day's clock (12:30 AM after a closing shift = 1470). */
export function operatingMinutes(now: Date): number {
  const m = now.getHours() * 60 + now.getMinutes();
  return now.getHours() < DAY_ROLLOVER_HOUR ? m + DAY : m;
}
