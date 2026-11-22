import { createClient } from "@supabase/supabase-js";

/**
 * The project address and the publishable key. The publishable key is meant to sit in the website
 * (it can only do what the database's security rules allow), so it is fine to have it here. Set
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_KEY to point at a different project.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://vlewbushxdzmcrkauwpc.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? "sb_publishable_nts5VCAzC8LRPy_0cyAUAg_KO7ctyqw";

export const supabase = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export type Role = "staff" | "lead" | "manager" | "owner";
export const isLeadSide = (r: Role) => r !== "staff";
export const ROLE_LABEL: Record<Role, string> = { staff: "Staff", lead: "Lead", manager: "Manager", owner: "Admin" };

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Google profile picture. */
  avatar_url?: string | null;
}
