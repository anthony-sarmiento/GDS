/** Names typed for custom positions (Tournament, Photo booth...), remembered on this device. */
const LABELS_KEY = "gds:custom-labels";

export function loadLabels(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LABELS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function saveLabels(list: string[]) {
  try {
    localStorage.setItem(LABELS_KEY, JSON.stringify(list));
  } catch {
    /* private mode: the names just are not remembered */
  }
}

/** Put a name at the front of the recent list (no duplicates, newest first, max 8). */
export function pushLabel(list: string[], name: string): string[] {
  const n = name.trim();
  if (!n) return list;
  return [n, ...list.filter((x) => x.toLowerCase() !== n.toLowerCase())].slice(0, 8);
}
