"use client";

import { fmt } from "@/lib/time";

/**
 * A time drop-down: a plain list of times between `min` and `max`, every `step` minutes.
 * Unlike the browser's own time picker it never wraps around, so nothing scrolls forever.
 */
export default function TimeSelect({
  value,
  min,
  max,
  step = 5,
  empty,
  label,
  className = "field",
  onChange,
}: {
  value: number | null;
  min: number;
  max: number;
  step?: number;
  /** Text for the "no time" choice. Leave out when a time is always needed. */
  empty?: string;
  label: string;
  className?: string;
  onChange: (t: number | null) => void;
}) {
  const first = Math.ceil(min / step) * step;
  const times: number[] = [];
  for (let t = first; t <= max; t += step) times.push(t);
  // keep a value that is off the list (an old entry) visible rather than silently changing it
  if (value != null && !times.includes(value)) {
    times.push(value);
    times.sort((a, b) => a - b);
  }
  return (
    <select
      className={className}
      value={value ?? ""}
      aria-label={label}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      {empty != null && <option value="">{empty}</option>}
      {times.map((t) => (
        <option key={t} value={t}>
          {fmt(t)}
        </option>
      ))}
    </select>
  );
}
