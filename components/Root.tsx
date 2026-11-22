"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import App from "./App";
import StaffApp from "./StaffApp";
import { loadProfile, saveMyAvatar } from "@/lib/cloud";
import { isLeadSide, Profile, Role, supabase } from "@/lib/supabase";

type Phase = { kind: "loading" } | { kind: "out"; error?: string } | { kind: "in"; profile: Profile; local: boolean };

/** While developing on this computer, ?dev=lead or ?dev=staff skips the sign-in. It is not part of the live site. */
function devRole(): Role | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const r = new URLSearchParams(window.location.search).get("dev");
  return r === "lead" || r === "staff" ? r : null;
}

function Brand() {
  return (
    <div className="brand">
      <Image src="/geekd-logo.webp" alt="GEEK'D Trading Cards & More" width={200} height={92} priority />
      <div className="brand-text">
        <h1>GDS</h1>
        <span>Geek&rsquo;d Deployment System</span>
      </div>
    </div>
  );
}

/** Signs people in with Google, then shows the lead side or the staff side depending on their account. */
export default function Root() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  // someone on the lead side can also be scheduled on the floor, so they can look at either side
  const [side, setSide] = useState<"lead" | "staff">("lead");

  const settle = useCallback(async () => {
    const dev = devRole();
    if (dev) {
      setPhase({ kind: "in", local: true, profile: { id: "dev", email: "dev@localhost", name: "Dev", role: dev } });
      return;
    }
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) {
      setPhase({ kind: "out" });
      return;
    }
    const name = (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? user.email ?? "";
    const profile = await loadProfile(user.id, user.email ?? "", name);
    if (!profile) {
      setPhase({ kind: "out", error: "Signed in, but your account could not be loaded. Has the database setup been run?" });
      return;
    }
    // the Google picture comes with the sign-in; keep a copy on the profile so leads can see it too
    const picture = (user.user_metadata?.avatar_url as string | undefined) ?? (user.user_metadata?.picture as string | undefined) ?? null;
    if (picture && picture !== profile.avatar_url) void saveMyAvatar(picture);
    setPhase({ kind: "in", profile: { ...profile, avatar_url: picture ?? profile.avatar_url ?? null }, local: false });
  }, []);

  useEffect(() => {
    void settle();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") void settle();
    });
    return () => data.subscription.unsubscribe();
  }, [settle]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setPhase({ kind: "out" });
  }, []);

  if (phase.kind === "loading") {
    return (
      <div className="shell">
        <div className="topbar">
          <Brand />
        </div>
      </div>
    );
  }

  if (phase.kind === "out") return <Login error={phase.error} />;

  const { profile, local } = phase;
  const lead = isLeadSide(profile.role);
  return lead && side === "lead" ? (
    <App profile={profile} cloud={!local} onSignOut={signOut} onSwitch={() => setSide("staff")} />
  ) : (
    <StaffApp profile={profile} cloud={!local} onSignOut={signOut} onSwitch={lead ? () => setSide("lead") : undefined} />
  );
}

function Login({ error }: { error?: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(error ?? "");

  async function google() {
    setBusy(true);
    setProblem("");
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin, queryParams: { prompt: "select_account" } },
    });
    if (e) {
      setProblem(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <Brand />
      </div>
      <div className="card login">
        <h2>Sign in</h2>
        <button className="btn primary big" onClick={google} disabled={busy}>
          {busy ? "Opening Google…" : "Continue with Google"}
        </button>
        {problem && <p className="note bad">{problem}</p>}
      </div>
    </div>
  );
}
