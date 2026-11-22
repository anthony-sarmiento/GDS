/** Small line icons drawn in SVG, so the interface never depends on emoji or symbol fonts. */
type Name = "x" | "check" | "undo" | "redo" | "grip";

const PATHS: Record<Name, React.ReactNode> = {
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  undo: <path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 12h-2" transform="translate(0 -3)" />,
  redo: <path d="M15 7l5 5-5 5M20 12H10a6 6 0 000 12h2" transform="translate(0 -3)" />,
  grip: (
    <g stroke="none" fill="currentColor">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </g>
  ),
};

export default function Icon({ name, size = 16 }: { name: Name; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
