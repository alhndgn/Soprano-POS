/**
 * TeqStudio markası: küçük "T + düğüm" işareti.
 * Renk `currentColor` ile gelir; koyu/açık temada kendiliğinden uyum sağlar.
 */
export function TeqMark({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="TeqStudio"
      className={`teq-mark ${className}`.trim()}
    >
      <rect width="48" height="48" rx="14" fill="currentColor" opacity="0.16" />
      <path
        d="M14 16.5h20M24 16.5v13"
        stroke="currentColor"
        strokeWidth="4.6"
        strokeLinecap="round"
      />
      <circle cx="24" cy="35" r="3.2" fill="currentColor" />
    </svg>
  )
}

export default function TeqStudio({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`studio-badge${compact ? ' compact' : ''}`} title="developed by TeqStudio">
      <TeqMark size={compact ? 15 : 17} />
      <span>
        {!compact && <em>developed by</em>}
        <b>TeqStudio</b>
      </span>
    </div>
  )
}
