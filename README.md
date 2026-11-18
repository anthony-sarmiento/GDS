# GDS — Geek'd Deployment System

Rotation and break tracking for the retail floor at GEEK'D Orlando. Inspired by Disney's CDS: add today's team, and GDS deals out Front / Bar / Dungeon blocks and plans everyone's breaks.

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

- **Team tab** – add people with clock in/out. Choose *Stays at …* for anyone who wants one spot all day, and tick *Floater* for the mid-shift break cover.
- **Board tab**
  - *Right now*: who is on Front / Bar / Dungeon, who is on break, and who covers.
  - *Break queue*: next breaks due. Start / End stamps the real time.
  - *Rotation grid*: tap any block to change it. Changed blocks are pinned (dot) and the auto-rotation works around them. "Re-deal from now" rebuilds the rest of the day.
  - *Coverage* and *Time at each position* show gaps and fairness.
- **Breaks tab** – the paper break log, live. Print it with *Print log*.
- **Clock chip (top right)** – click it to preview the board at another time (handy for planning). *Back to live* resets it.

### Break rules (from the paper log)

| Shift length | Breaks |
| --- | --- |
| under 7 hrs | 1 × 20 min |
| 7 to under 9 hrs | 1 × 30–60 min |
| 9 to under 12 hrs | 1 × 20 min + 1 × 30–60 min |
| 12+ hrs | 2 × 20 min + 1 × 30–60 min |

Break length is editable per break, and breaks can be added or removed. Rules live in `lib/breaks.ts` (`requiredBreaks`).

### Engine notes

- `lib/breaks.ts` – break rules and planner. Breaks are staggered (1 at a time by default), land near the middle of the shift, and prefer times when the floor is fully staffed.
- `lib/rotation.ts` – rotation. Every position gets covered (Front, then Bar, then Dungeon), no one repeats a position back-to-back, and people drift toward the positions they have spent the least time at.
- Rotation block length (default 60 min) and the "rotation clock starts at" time (default 10:00 AM) are in Team → Settings.
