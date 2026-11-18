export type Position = "front" | "bar" | "dungeon";
export const POSITIONS: Position[] = ["front", "bar", "dungeon"];

export const POSITION_LABEL: Record<Position, string> = {
  front: "Front",
  bar: "Bar",
  dungeon: "Dungeon",
};

/** One break on the log. All times are minutes since midnight (can exceed 1440 for after-midnight). */
export interface Brk {
  id: string;
  /** Required length in minutes (20 / 30 / 45 / 60 ...). */
  length: number;
  /** Suggested start time from the planner (or set by hand when `locked`). */
  planned: number | null;
  /** The planned time was set by hand; the planner leaves it alone. */
  locked: boolean;
  /** Actual start / end, stamped when the break is really taken. */
  start: number | null;
  end: number | null;
  empInitials: string;
  leadInitials: string;
  notes: string;
}

export interface Shift {
  id: string;
  name: string;
  /** Clock in, minutes since midnight. */
  start: number;
  /** Clock out, minutes since midnight. Greater than 1440 when the shift crosses midnight. */
  end: number;
  /** Stays at one position all day. null = rotates. */
  lock: Position | null;
  /** Mid-shift floater who covers breaks. */
  floater: boolean;
  breaks: Brk[];
  /** The break list was edited by hand, so don't regenerate it when the shift times change. */
  breaksCustom: boolean;
}

export interface Cell {
  pos: Position;
  /** Set by hand; auto-rotate never moves it. */
  pinned: boolean;
}

export interface DayState {
  date: string; // YYYY-MM-DD
  opener: string;
  closer: string;
  shifts: Shift[];
  /** key = `${shiftId}@${slotStartMinute}` */
  cells: Record<string, Cell>;
}

export interface Settings {
  /** Minutes between rotations. */
  rotationMinutes: number;
  /** Rotation grid is anchored to this time (default store open, 10:00). */
  anchor: number;
  /** How many people may be on break at the same time. */
  maxConcurrentBreaks: number;
}

export interface AppState {
  settings: Settings;
  /** Every name ever typed in, for autocomplete. */
  names: string[];
  days: Record<string, DayState>;
}

export const DEFAULT_SETTINGS: Settings = {
  rotationMinutes: 60,
  anchor: 10 * 60,
  maxConcurrentBreaks: 1,
};
