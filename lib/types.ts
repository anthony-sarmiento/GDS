export type Position = "front" | "bar" | "dungeon";
export const POSITIONS: Position[] = ["front", "bar", "dungeon"];

export const POSITION_LABEL: Record<Position, string> = {
  front: "Front",
  bar: "Bar",
  dungeon: "Dungeon",
};

/** One break on the log. All times are minutes since midnight (can exceed 1440 for after-midnight). */
export type LeadRole = "opening" | "closing" | "inventory" | "custom";
export const LEAD_LABEL: Record<LeadRole, string> = {
  opening: "Opening Lead",
  closing: "Closing Lead",
  inventory: "Inventory Lead",
  custom: "Custom",
};

/** What to call someone's assignment when they are off the rotation. */
export const roleName = (s: { role?: LeadRole | null; roleLabel?: string }): string =>
  !s.role ? "" : s.role === "custom" ? s.roleLabel?.trim() || "Custom" : LEAD_LABEL[s.role];

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
  /** When the person asked to take this break. The lead plans around it where that is realistic. */
  preferred?: number | null;
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
  /** Leads are not part of the rotation. They have a role instead of a position. */
  role?: LeadRole | null;
  /** The name typed in for a "custom" assignment, e.g. "Events". */
  roleLabel?: string;
  breaks: Brk[];
  /** The break list was edited by hand, so don't regenerate it when the shift times change. */
  breaksCustom: boolean;
  /** Set when the lead bumped this person out: the time they were sent home. */
  sentHomeAt?: number;
  /** Name of the person who took over (for the board label). */
  bumpedBy?: string;
  /** When the lead gave them "Bumpout" as their assignment. They stay on until they (or the lead) finish it. */
  bumpoutAt?: number;
  /** The clock-out time they were scheduled for, kept when they stay on past it waiting for their bumpout. */
  scheduledEnd?: number;
}

/** A block on the board is one of the three positions, or "other" with a label the lead types in. */
export type CellPos = Position | "other";

export interface Cell {
  pos: CellPos;
  /** Name for an "other" block, e.g. "Tournament". */
  label?: string;
  /** Set by hand; auto-rotate never moves it. */
  pinned: boolean;
  /** This block exists to cover a break (the break's id). It goes away if the break does. */
  cover?: string;
  /** Where someone goes once this break ends (the break's id). It goes away if the break does. */
  after?: string;
  /** Walking between spots: a few minutes when they are on neither. */
  transit?: boolean;
  /** Last column of an assignment the lead gave an end time: nothing carries on after it. */
  ends?: boolean;
  /** "Bumpout" is their assignment. */
  bump?: boolean;
}

/** One bathroom check. Anyone can do one, so `by` is optional. */
export interface Check {
  id: string;
  /** Minutes on the operating day's clock (can exceed 1440 after midnight). */
  time: number;
  by: string;
}

export interface DayState {
  date: string; // YYYY-MM-DD
  opener: string;
  closer: string;
  shifts: Shift[];
  /** key = `${shiftId}@${cellStartMinute}`; one cell per grid column the person is working. */
  cells: Record<string, Cell>;
  /** Bathroom checks done today. Missing on days saved before checks existed. */
  checks?: Check[];
}

/** SOP staffing for one position: how many people should be on it at once. */
export interface Limits {
  min: number;
  max: number;
}

export interface Settings {
  /** Minutes between automatic rotations. */
  rotationMinutes: number;
  /** Smallest step on the board in minutes. Everything is painted and placed at this precision. */
  gridMinutes: number;
  /** The grid is anchored to this time (default 10:00, when the lead opens). */
  anchor: number;
  /** How many people may be on break at the same time. */
  maxConcurrentBreaks: number;
  /** A bathroom check is recommended this often (minutes). A reminder only, never required. */
  checkMinutes: number;
  /** Minutes it takes to walk from one spot to the next or to a break. */
  transitMinutes: number;
  limits: Record<Position, Limits>;
}

/** A saved person. `email` links them to their Google account so they can sign in to the staff side. */
export interface TeamMember {
  id: string;
  name: string;
  email?: string | null;
}

export interface AppState {
  settings: Settings;
  /** Every name ever typed in, for autocomplete. */
  names: string[];
  /** Saved people (kept in the database too). */
  team?: TeamMember[];
  days: Record<string, DayState>;
}

export const DEFAULT_LIMITS: Record<Position, Limits> = {
  front: { min: 1, max: 2 },
  bar: { min: 2, max: 3 },
  dungeon: { min: 1, max: 1 },
};

export const DEFAULT_SETTINGS: Settings = {
  rotationMinutes: 60,
  gridMinutes: 5,
  anchor: 10 * 60,
  maxConcurrentBreaks: 1,
  checkMinutes: 90,
  transitMinutes: 5,
  limits: DEFAULT_LIMITS,
};
