import { supabase, Profile, Role } from "./supabase";
import { DayState, Settings, TeamMember } from "./types";

/** Everything here talks to Supabase. Each call returns quietly (null / false) if the network or a rule says no. */

/** Reads profiles. Falls back to the columns that always exist if the picture column has not been added yet. */
async function readProfiles(filter?: { id: string }): Promise<Profile[]> {
  const run = (cols: string) => {
    const q = supabase.from("profiles").select(cols);
    return filter ? q.eq("id", filter.id) : q.order("created_at");
  };
  let res = await run("id,email,name,role,avatar_url");
  if (res.error) res = await run("id,email,name,role");
  return ((res.data as unknown) as Profile[] | null) ?? [];
}

export async function loadProfile(userId: string, email: string, name: string): Promise<Profile | null> {
  const read = async () => (await readProfiles({ id: userId }))[0] ?? null;
  let data = await read();
  if (!data) {
    // the database normally makes this on first sign-in; this covers the case where it has not run yet
    await supabase.from("profiles").insert({ id: userId, email, name, role: "staff" });
    data = await read();
  }
  return data;
}

/** Keep this person's Google picture on their profile so leads can see it. Quietly does nothing if it cannot. */
export async function saveMyAvatar(url: string): Promise<void> {
  await supabase.rpc("save_my_avatar", { p_url: url });
}

export async function loadAccounts(): Promise<Profile[]> {
  return readProfiles();
}

export async function setRole(id: string, role: Role): Promise<boolean> {
  const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
  return !error;
}

/** The most recent saved days (the board, assignments, break log and checks for each date). */
export async function loadRecentDays(sinceDate: string): Promise<Record<string, DayState>> {
  const { data } = await supabase.from("days").select("date,data").gte("date", sinceDate);
  return Object.fromEntries(((data as { date: string; data: DayState }[] | null) ?? []).map((r) => [r.date, r.data]));
}

export async function loadDay(date: string): Promise<DayState | null> {
  const { data } = await supabase.from("days").select("data").eq("date", date).maybeSingle();
  return (data?.data as DayState | undefined) ?? null;
}

export async function dayDates(): Promise<string[]> {
  const { data } = await supabase.from("days").select("date").order("date", { ascending: false });
  return ((data as { date: string }[] | null) ?? []).map((r) => r.date);
}

/** Every saved day, for the History tab and name search. Days hold a little JSON each, so this stays small. */
export async function loadHistory(limit = 400): Promise<DayState[]> {
  const { data } = await supabase.from("days").select("data").order("date", { ascending: false }).limit(limit);
  return ((data as { data: DayState }[] | null) ?? []).map((r) => r.data);
}

export async function saveDay(day: DayState, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from("days")
    .upsert({ date: day.date, data: day, updated_at: new Date().toISOString(), updated_by: userId });
  return !error;
}

export async function loadSettings(): Promise<Settings | null> {
  const { data } = await supabase.from("settings").select("data").eq("id", 1).maybeSingle();
  return (data?.data as Settings | undefined) ?? null;
}

export async function saveSettings(settings: Settings): Promise<boolean> {
  const { error } = await supabase.from("settings").upsert({ id: 1, data: settings, updated_at: new Date().toISOString() });
  return !error;
}

export async function loadTeam(): Promise<TeamMember[]> {
  const { data } = await supabase.from("team").select("id,name,email").order("name");
  return (data as TeamMember[] | null) ?? [];
}

export async function saveMember(m: TeamMember): Promise<boolean> {
  const { error } = await supabase.from("team").upsert({ id: m.id, name: m.name, email: m.email?.trim() || null });
  return !error;
}

export async function deleteMember(id: string): Promise<boolean> {
  const { error } = await supabase.from("team").delete().eq("id", id);
  return !error;
}

/** Break presses from staff phones that the lead's screen has not applied yet. */
export interface StaffEvent {
  id: number;
  date: string;
  shift_id: string;
  break_id: string;
  kind: "start" | "end";
  at: number;
}

export async function loadOpenEvents(): Promise<StaffEvent[]> {
  const { data } = await supabase
    .from("staff_events")
    .select("id,date,shift_id,break_id,kind,at")
    .eq("applied", false)
    .order("id");
  return (data as StaffEvent[] | null) ?? [];
}

export async function markApplied(ids: number[]): Promise<void> {
  if (ids.length) await supabase.from("staff_events").update({ applied: true }).in("id", ids);
}

export function listenForEvents(onEvent: () => void): () => void {
  const channel = supabase
    .channel("staff-events")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "staff_events" }, onEvent)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** What a staff member sees: their own shift for the day and nothing else. */
export interface MyDay {
  linked: boolean;
  name?: string;
  shifts?: import("./types").Shift[];
  cells?: Record<string, import("./types").Cell>;
  settings?: Settings | null;
  events?: { shift_id: string; break_id: string; kind: "start" | "end"; at: number }[];
}

export async function loadMyDay(date: string): Promise<MyDay | null> {
  const { data, error } = await supabase.rpc("my_day", { d: date });
  return error ? null : (data as MyDay);
}

export async function pressBreak(date: string, shiftId: string, breakId: string, kind: "start" | "end", at: number): Promise<boolean> {
  const { error } = await supabase.rpc("staff_break", { d: date, p_shift: shiftId, p_break: breakId, p_kind: kind, p_at: at });
  return !error;
}
