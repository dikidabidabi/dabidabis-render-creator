interface LogoProps {
  className?: string;
  size?: number;
}

export function LogoDabidabi({ className = "", size = 40 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer D contour as labyrinth walls */}
      <path
        d="M15 15 L15 85 L50 85 C72 85 85 72 85 50 C85 28 72 15 50 15 L15 15"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Inner labyrinth path - spirals toward center */}
      {/* Track 1 */}
      <path
        d="M28 28 L28 72 L50 72 C63 72 72 63 72 50 C72 37 63 28 50 28 L28 28"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.35"
      />
      {/* Track 2 */}
      <path
        d="M38 38 L38 62 L50 62 C56 62 62 56 62 50 C62 44 56 38 50 38 L38 38"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.25"
      />
      {/* Track 3 - leads to center */}
      <path
        d="M46 46 L46 54 L50 54 C52 54 54 52 54 50 C54 48 52 46 50 46 L46 46"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.18"
      />
      {/* Center dot - the destination */}
      <circle cx="50" cy="50" r="3" fill="currentColor" opacity="0.9" />
      {/* Entry arrow hint - subtle */}
      <path
        d="M20 22 L25 22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}
