// The one decorative flourish: a postmark stamped on the sheet once the notes are sent for approval.

interface Props {
  date: Date
  pr?: string
}

const CX = 136
const CY = 62

/** Arc through the ring band; the bottom arc runs the other way so its text reads upright. */
function arc(r: number, top: boolean): string {
  return top
    ? `M ${CX - r} ${CY} A ${r} ${r} 0 0 1 ${CX + r} ${CY}`
    : `M ${CX - r} ${CY} A ${r} ${r} 0 0 0 ${CX + r} ${CY}`
}

export function Postmark({ date, pr }: Props) {
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return (
    <svg className="postmark" width="200" height="124" viewBox="0 0 200 124" role="img" aria-label="Sent for approval">
      <defs>
        <path id="pm-top" d={arc(44, true)} />
        <path id="pm-bottom" d={arc(50.5, false)} />
      </defs>
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} d={`M 6 ${36 + i * 13} q 9 -5 18 0 t 18 0 t 18 0 t 18 0`} opacity="0.7" />
        ))}
        <circle cx={CX} cy={CY} r="55" />
        <circle cx={CX} cy={CY} r="41" />
      </g>
      <g fill="currentColor" fontFamily="var(--ui)" fontWeight="700" fontSize="9" letterSpacing="1.3">
        <text>
          <textPath href="#pm-top" startOffset="50%" textAnchor="middle">
            SENT FOR APPROVAL
          </textPath>
        </text>
        <text>
          <textPath href="#pm-bottom" startOffset="50%" textAnchor="middle">
            MAILMAN
          </textPath>
        </text>
      </g>
      <text x={CX} y={CY + 3} textAnchor="middle" fill="currentColor" fontFamily="var(--letter)" fontSize="18" fontWeight="600">
        {day}
      </text>
      {pr && (
        <text x={CX} y={CY + 20} textAnchor="middle" fill="currentColor" fontFamily="var(--ui)" fontSize="10" fontWeight="600">
          PR #{pr}
        </text>
      )}
    </svg>
  )
}
