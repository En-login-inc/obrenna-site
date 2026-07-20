export type StatusTone = "good" | "warn" | "bad" | "neutral" | "teal";

export default function Status({ tone = "good", children }: { tone?: StatusTone; children: React.ReactNode }) {
  return (
    <span className={`status status-${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
