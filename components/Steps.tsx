/** The three things a lead does with GDS, shown on the empty screens. */
export default function Steps() {
  const steps = [
    ["Add the team", "Names and clock in / out times on the Team tab."],
    ["Assign positions", "Before people arrive, give each one a starting position on the Board. They stay there until you move them."],
    ["Run the day", "Send people on break, move them around, and log bathroom checks as they happen."],
  ];
  return (
    <ol className="steps">
      {steps.map(([title, text], i) => (
        <li key={title}>
          <span className="step-n">{i + 1}</span>
          <div>
            <b>{title}</b>
            <p>{text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
