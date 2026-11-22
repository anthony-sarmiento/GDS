# GDS — Geek'd Deployment System

Rotation and break tracking for the retail floor at GEEK'D Orlando. Inspired by Disney's CDS: add today's team, then the lead assigns each person a position and sends them on breaks. GDS never picks positions or breaks by itself.

No login, no database. Everything is saved in the browser (`localStorage`) on the device you use.

## Run it

```powershell
npm install
npm run dev      # http://localhost:3000
npm test         # engine tests (break rules, rotation, cover)
npm run build
```

## Deploy

Push to GitHub, then import the repo in Vercel. It is a stock Next.js app; no environment variables needed.

## How it works

- **Team tab** – add people with clock in/out. Quick-fill buttons: Opening Lead 10–5:15, Opener 11–5, Closer 5–11:15, Closer 5–11:45, Floater 1–9, Closing Lead, Inventory Lead. *Works as* is On the board, Stays at a position all day, or a lead role. **Nobody gets a position when they are added.** The lead assigns each person's starting position from the Board before they arrive, and moves them from there. **Leads are not on the board**: they have a role (Opening / Closing / Inventory Lead) and show up on the break log and break timer only.
- **Board tab** (CDS style, minute precision)
  - **Needs a position**: anyone working now, or arriving within four hours, who has no position yet shows in an amber card with an Assign button. Their row on the timeline says "needs a position".
  - **Assign**: send someone somewhere at a time. Open it from the Assign button, a person's Assign button in Right now, their name, or by tapping a row at the time you want. Pick who you are moving, where to (Front, Bar, Dungeon, a **Custom** name you type like Tournament, or **Break**), then, if you want, for how long (30 min / 1 hr / 2 hr, or exact times from a drop-down). With no length they stay until their bumpout. A length is a real end: afterwards the row shows nothing assigned (a faint gray block). A position is held until you move the person, so the default is the rest of the shift. A custom spot or a cover block is temporary: afterwards they go back to where they were. It shows what the move does to the position they leave and the one they join, and offers a cover. Only that stretch changes.
  - *Right now*: who is on Front / Bar / Dungeon, who is on break, who is short, and who could move to cover. Each person has **Assign** (somewhere, or on break) and **Bumpout** buttons. The big **Assign** button at the top opens the same dialog.
  - *Breaks*: breaks that are placed or running get a timer (Start / End stamps real times). Breaks nobody has placed yet show as a row of **Still owed a break** names; tap one to send that person.
  - *Board*: a continuous timeline, one row per person, snapping to 5 minutes. The brushes are tucked behind **Paint by hand**. Open it, pick a **brush** (keys `1` Front, `2` Bar, `3` Dungeon, `4` Break, `0` Erase, `Esc` to put it down) and **drag across a row for an exact range**. A plain click repaints the whole block under the cursor. Neighbouring blocks on the same position merge into one. Painted ranges are pinned (thin underline) and never move on their own. Zoom with − / +.
  - *Custom brush* (key `5`): the same custom names, painted by drag. Type any name (Tournament, Photo booth, Inventory...) and paint it like a position. Recent names show as quick buttons. Custom blocks are pink, are not counted as Front, Bar or Dungeon, and never move on their own, so coverage shows the gap while someone is on one.
  - *Break brush*: drag to set the exact start and end of a break, or click to drop it at that minute using its normal length.
  - *Coverage*: people on each position over the day. Red = empty, amber = short or over the max.
  - *Bumpout*: the evening person takes a specific opener's position and the opener is bumped out (they clock out on the iPad). The replacement is pinned to that position for the rest of the block.
- **Breaks tab** – the paper break log, live. *Print log* gives a landscape page with clock in/out, break length, start/end, initials and notes. Grey times are planned; write in the real ones.
- **On a phone**: bottom tab bar, a sticky brush bar (after **Paint by hand**) with a **Pan** mode for scrolling and a **Now** button, a narrow name column, the break log as one card per break, and dialogs that slide up as a sheet. With a brush picked, a sideways drag paints and an up/down drag still scrolls the page.
- **Break lengths follow the log**: *Assign → Break* offers 20, 30, 45 and 60 minutes and marks the ones the person still owes (a 20 minute break, or a 30–60 minute one). A length the log does not call for still works, and is flagged as an extra break.
- **Checks tab** – bathroom checks. Log one at any time (anyone can do them, who is optional) and see how long ago the last one was, the gap between each check, the average and the longest gap. A reminder banner (“Hey! Your last bathroom check was … ago”) appears after the recommended interval, 1h 30m by default (change it in Team → Settings). It is a nudge only: **Later** hides it for 30 minutes.
- **Undo / Redo** (top of the page, or `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`): steps back and forward through changes to the day you are viewing: painting, assignments, breaks and covers, bump outs, and team edits. A quick burst of typing counts as one step. History is kept for this visit only (a reload starts fresh) and does not include settings.
- **Clock chip (top right)** – click it to preview the board at another time. *Back to live* resets it.

### Cover rule

Someone has to be on a position while its holder is on break, and **you choose who**. GDS never moves anyone over by itself.

**GDS does not recommend or schedule breaks.** The board only shows a break once you put it there (Assign → Break, the Break brush, or Start). Until then each break someone still owes is listed under "Still owed a break".

When you press **Start** on a break, place one with the Break brush, or send someone on **Break** from Assign, GDS asks **who rotates over**. It lists everyone free for the whole break with what moving them does ("Front stays staffed", "Bar drops to 1 (needs 2)", "Leaves Dungeon empty"), marks its best guess as **Suggested** without selecting it, and has a **Nobody** choice. When the position would be left short you have to pick someone (or Nobody) before it goes ahead. Your pick is pinned onto the position for the length of the break and removed again if the break is moved or erased. Moving someone with Assign asks the same question about the position they leave. Leads and people on a custom block have no position to cover, so they are never asked. Typing times into the break log re-covers quietly and only asks if a position would be left empty.

### A day in GDS

1. **Before anyone arrives** the lead adds the team and gives everyone a starting position (Board → Assign, default until their bumpout). When staff walk in they see where they start.
2. **While they get set up** the lead asks when each person would like their break and types it in on the **Breaks** tab (*Break planner*). **Plan breaks** lays the day out around those times and shows the result first: who gets their exact time, who had to move and by how much, who covers, and where a position runs short. Nothing reaches the board until you press *Put on the board*. Breaks nobody asked for are left alone.
3. **During the day** a person stays on their position until their break. A break is also a rotation: when you pick who covers, that person stays where they went and the person on break takes the cover's old spot when they come back. Taking the break off the board undoes it.
4. **Assign** moves one person at a time: who, where to, and (optionally) for how long. Nobody is ever rotated as a whole board. With no length the assignment lasts until their bumpout.
5. **Walking takes a few minutes.** A move or cover shows the person as *Moving* for the first few minutes (5 by default, 0 / 5 / 10 in Team → Settings). A position that is short only because someone is on the way shows in blue as "Someone is on the way" instead of red.
6. **Bathroom checks** are logged on the Checks tab, and the reminder banner shows when one is overdue. The lead is the one who makes sure they happen.

### Staffing

Front 1–2, Bar 2–3, Dungeon exactly 1 by default (editable in Team → Staffing). The board flags a position that is short, empty or over the maximum. It never moves anyone to fix it.

### Break rules (from the paper log)

| Shift length | Breaks |
| --- | --- |
| under 7 hrs | 1 × 20 min |
| 7 to under 9 hrs | 1 × 30–60 min |
| 9 to under 12 hrs | 1 × 20 min + 1 × 30–60 min |
| 12+ hrs | 2 × 20 min + 1 × 30–60 min |

Break length is editable per break, and breaks can be added or removed. Rules live in `lib/breaks.ts` (`requiredBreaks`).

### Engine notes

- `lib/breaks.ts` – break rules (how many, how long). It also contains a break-time planner that is no longer used by the app, since breaks are scheduled by hand.
- `lib/rotation.ts` – builds the board from what the lead assigned. Assigned and painted columns are kept; a column with nothing assigned inherits the person's last position (cover blocks and custom spots do not count), and before a person's first assignment it stays empty. There is no auto-dealing.
- `lib/cover.ts` – the cover rule for breaks.
- `lib/store.ts` – state helpers: painting, break placement, bump out.
- "Board starts at" (default 10:00 AM) anchors the board columns.

## Accounts and the database (Supabase)

GDS signs people in with Google and keeps its data in Supabase. There are two sides, picked by the account's role:

- **Lead side** (Lead, Manager, Owner): the full board, breaks, bathroom checks, team, and a **History** tab with every saved day (searchable by name). Days, settings and saved people sync to the database; this browser keeps a copy too.
- **Staff side** (Staff): where they are now, what is next, their bumpout notice, and **Start break / End break**. Presses show up on the lead's screen right away.

Setup, once:

1. Supabase → SQL Editor → paste `supabase/schema.sql` → Run. It creates the tables and the security rules, and makes `antsarmiento440@gmail.com` the first Lead.
2. Supabase → Authentication → URL Configuration: set **Site URL** to the live site and add `http://localhost:3000` to **Redirect URLs**.
3. Turn on the Google provider (Authentication → Sign In / Providers).
4. Leads, managers and admins are saved in People automatically (with their email), so they can also be put on the floor and use **My shift**. Admin tab (admins only; `antsarmiento440@gmail.com` is the first admin): Accounts promotes new sign-ins (everyone starts as Staff) and People holds each person's Google email(s), comma separated, so their sign-in lands on their own shift. A lead who is also scheduled on the floor uses the **My shift** / **Lead view** buttons to switch sides.
5. `supabase/fresh-start.sql` wipes saved days and people (test data) and saves Anthony Sarmiento with his retail email.

The project URL and publishable key are in `lib/supabase.ts` (override with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY`). The publishable key is safe in the browser; the database security rules are what protect the data. Never put the `service_role` key in this project.

On your own computer, `?dev=lead` or `?dev=staff` skips sign-in (development only, not in the live build).

## Assign chains and row order

In **Assign**, **+ Add rotation** adds the next person to the same action: *who at the Front is moving, and where are they going?* Keep adding as many as you need. Each step can send someone to a position, on break, or on bumpout; a break comes back to the spot the previous mover left. Earlier steps collapse to one line, and the buttons stay at the bottom, so a long chain never leaves the page.

On the Board, drag the ⋮⋮ handle beside a name to move that row up or down. The order is saved with the day.

Changes are saved to the database a moment after you make them. The header shows ✓ Saved, Saving… or a retry warning, a failed save is retried, and a second device picks up the newer copy when this one has nothing unsaved.
