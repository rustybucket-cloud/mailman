// Small stroke icons, sized to sit on the 13px UI text baseline.

const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const PlusIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
)

export const CloseIcon = () => (
  <svg {...base} width={14} height={14} aria-hidden>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </svg>
)

export const SlidersIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" />
    <circle cx="11" cy="4.5" r="1.5" />
    <circle cx="5" cy="11.5" r="1.5" />
  </svg>
)

/** Brand mark: an envelope. */
export const EnvelopeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
    <path d="M3 5.5l7 5.5 7-5.5" />
  </svg>
)
