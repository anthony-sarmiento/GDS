import { AppState, DayState, Settings } from "@/lib/types";

export interface Ctx {
  state: AppState;
  day: DayState;
  settings: Settings;
  /** Minutes on the operating-day clock: the real time on a live day, the preview time, or null. */
  now: number | null;
  /** The viewed day is today and `now` is the real clock. */
  live: boolean;
  /** Apply a change to the viewed day. `auto` re-runs break placement + rotation afterwards. */
  mutate: (fn: (day: DayState) => DayState, opts?: { auto?: boolean; replanBreaks?: boolean }) => void;
  setSettings: (patch: Partial<Settings>) => void;
  /** Remember a typed name for autocomplete. */
  remember: (name: string) => void;
  flash: (msg: string) => void;
}

export const FIRST_NAME = (name: string) => name.trim().split(/\s+/)[0] || "—";
