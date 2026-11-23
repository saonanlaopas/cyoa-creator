export function PocketWatch() {
  return <svg viewBox="0 0 144 112" aria-hidden="true" className="inventory-art">
    <rect width="144" height="112" rx="4" fill="#213c39" />
    <path d="M9 91H135M9 96H135" stroke="#36504a" />
    <g transform="rotate(-17 72 60)">
      <circle cx="72" cy="17" r="8" fill="none" stroke="#c8a268" strokeWidth="4" />
      <path d="M76 12Q96 3 110 14T137 7M77 15Q96 7 111 17" fill="none" stroke="#88acd0" strokeWidth="2.5" />
      <rect x="66" y="22" width="12" height="9" rx="2" fill="#bd965b" />
      <circle cx="72" cy="64" r="37" fill="#937349" stroke="#ddbd83" strokeWidth="2" />
      <circle cx="72" cy="63" r="31" fill="#f2e5c6" stroke="#564c3d" strokeWidth="2" />
      {Array.from({length:12}, (_, i) => <path key={i} d="M72 35v4" stroke="#63543e" strokeWidth="2" transform={`rotate(${i*30} 72 63)`} />)}
      <path d="M59 53l13 10 16-14" stroke="#283d3b" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="72" cy="63" r="3" fill="#ac854e" />
    </g>
  </svg>;
}
