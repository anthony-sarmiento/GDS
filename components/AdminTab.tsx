"use client";

import { useEffect, useState } from "react";
import { Ctx } from "./ctx";
import { loadAccounts, setRole } from "@/lib/cloud";
import { isLeadSide, Profile, Role, ROLE_LABEL } from "@/lib/supabase";

/** For admins only: who can sign in and as what, and the saved people. */
export default function AdminTab({ ctx, selfId }: { ctx: Ctx; selfId: string }) {
  return (
    <div>
      <AccountsCard selfId={selfId} />
      <PeopleCard ctx={ctx} />
    </div>
  );
}

/** Everyone saved so far. Search, pick a name to add them to today, and link a Google email so they can sign in on their phone. */
function PeopleCard({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const people = ctx.team.filter((m) => !needle || m.name.toLowerCase().includes(needle) || (m.email ?? "").toLowerCase().includes(needle));
  const here = new Set(ctx.day.shifts.map((s) => s.name.trim().toLowerCase()));

  return (
    <>
      <div className="section-title">
        <h2>People</h2>
        <span className="spacer" />
        <input
          className="field"
          type="search"
          placeholder="Search saved people"
          aria-label="Search saved people"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="card scroll-list">
        {ctx.team.length === 0 && <div className="muted">Nobody saved yet. People you add to a day are saved here.</div>}
        {ctx.team.length > 0 && people.length === 0 && <div className="muted">No one matches.</div>}
        {people.map((m) => (
          <div className="people-row" key={m.id}>
            <b>
              {m.name}
              {here.has(m.name.trim().toLowerCase()) && <small className="muted"> · on today</small>}
            </b>
            <input
              className="field"
              type="email"
              placeholder="Google email(s), comma separated"
              aria-label={`Google email for ${m.name}`}
              defaultValue={m.email ?? ""}
              onBlur={(e) => {
                const email = e.target.value.split(/[\s,;]+/).filter(Boolean).join(",").toLowerCase();
                if (email !== (m.email ?? "")) ctx.saveMember({ ...m, email: email || null });
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn danger small"
                aria-label={`Forget ${m.name}`}
                onClick={() => {
                  if (window.confirm(`Forget ${m.name}? Past days keep their name.`)) ctx.removeMember(m.id);
                }}
              >
                Forget
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Who has signed in, and which side of the site they see. */
function AccountsCard({ selfId }: { selfId: string }) {
  const [accounts, setAccounts] = useState<Profile[] | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    void loadAccounts().then(setAccounts);
  }, []);

  async function change(a: Profile, role: Role) {
    const ok = await setRole(a.id, role);
    setMsg(ok ? `${a.name || a.email} is now ${ROLE_LABEL[role]}` : "That change was not allowed.");
    if (ok) setAccounts((cur) => (cur ?? []).map((x) => (x.id === a.id ? { ...x, role } : x)));
  }

  return (
    <>
      <div className="section-title">
        <h2>Accounts</h2>
      </div>
      <div className="card scroll-list">
        {accounts == null && <div className="muted">Loading…</div>}
        {accounts?.map((a) => (
          <div className="people-row" key={a.id}>
            <b>{a.name || a.email}</b>
            <span className="muted">{a.email}</span>
            <select
              className="field"
              disabled={a.id === selfId}
              title={a.id === selfId ? "You cannot change your own role" : undefined}
              value={a.role}
              aria-label={`Role for ${a.name || a.email}`}
              onChange={(e) => change(a, e.target.value as Role)}
            >
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                  {isLeadSide(r) ? "" : " (staff side)"}
                </option>
              ))}
            </select>
          </div>
        ))}
        {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </>
  );
}
