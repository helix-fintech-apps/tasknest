/** The Nest mark: nested arcs forming a shallow bowl, with a yolk resting in it. 24-unit grid. */
export function NestMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="24" height="24" rx="6" fill="var(--color-dusk-600)" />
      <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
        <path d="M4.5 12.5a7.5 7.5 0 0 0 15 0" />
        <path d="M7 12.5a5 5 0 0 0 10 0" />
      </g>
      <circle cx="12" cy="10.8" r="2.1" fill="var(--color-yolk-400)" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <NestMark />
      <span className="font-display text-xl font-bold tracking-tight text-fg">TaskNest</span>
    </span>
  );
}
