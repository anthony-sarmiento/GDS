"use client";

import { useState } from "react";

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** A round Google picture, or the person's initials when there is none (or it does not load). */
export default function Avatar({ url, name, size = 32 }: { url?: string | null; name: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (url && !bad) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="avatar" style={style} src={url} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} />;
  }
  return (
    <span className="avatar init" style={style} aria-hidden>
      {initials(name)}
    </span>
  );
}
