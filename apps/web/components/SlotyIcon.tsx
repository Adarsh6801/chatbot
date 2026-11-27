export default function SlotyIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M 32 19 H 21 Q 14 19 14 26 V 39 Q 14 46 20 46 L 19 55 L 28 46 H 43 Q 50 46 50 39 V 34"
        stroke="#1f231e"
        strokeWidth="4.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26.5" cy="33" r="3.1" fill="#1f231e" />
      <circle cx="38.5" cy="33" r="3.1" fill="#1f231e" />
      <path
        d="M 39 9 H 52 Q 55 9 55 12 V 25 Q 55 28 52 28 H 47.5 A 3.4 3.4 0 1 1 41.5 28 H 39 Q 36 28 36 25 V 21.5 A 3.2 3.2 0 1 0 36 15.5 V 12 Q 36 9 39 9 Z"
        fill="#c6ee2e"
      />
    </svg>
  );
}
