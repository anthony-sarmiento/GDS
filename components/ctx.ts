import { AppState, DayState, Position, Settings, TeamMember } from "@/lib/types";
import { CoverOption } from "@/lib/cover";

/** Asks the lead who rotates over to a position while its holder is on break. */
export interface CoverPrompt {
  title: string;
  confirmLabel: string;
  holder: string;
  position: Position;
  /** "2:10 PM–2:30 PM · 20 min" */
  when: string;
  remaining: number;
  min: number;
  options: CoverOption[];
  /** `null` means nobody covers. */
  onConfirm: (choice: string | null) => void;
}

export interface Ctx {
  state: AppState;
  day: DayState;
  settings: Settings;
  /** Minutes on the operating-day clock: the real time on a live day, the preview time, or null. */
  now: number | null;
  /** The viewed day is today and `now` is the real clock. */
  live: boolean;
  /**
   * Apply a change to the viewed day.
   * `auto: true` re-derives the board afterwards: each person stays where the lead last sent them.
   * Nobody is given a position by GDS itself.
   */
  mutate: (
    fn: (day: DayState) => DayState,
    opts?: { auto?: boolean; /** false = not an undo step (automatic housekeeping) */ record?: boolean },
  ) => void;
  setSettings: (patch: Partial<Settings>) => void;
  /** Remember a typed name for autocomplete. */
  remember: (name: string) => void;
  flash: (msg: string) => void;
  /** Open the "who covers?" question. */
  askCover: (prompt: CoverPrompt) => void;
  /** Signed in with the database behind it (false only on a developer's own computer). */
  cloud: boolean;
  /** Saved people. */
  team: TeamMember[];
  /** Google picture by lowercase email, for the people who have signed in. */
  avatars: Record<string, string>;
  saveMember: (m: TeamMember) => void;
  removeMember: (id: string) => void;
}

export const FIRST_NAME = (name: string) => name.trim().split(/\s+/)[0] || "—";
