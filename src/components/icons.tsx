const shared = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

export function GearIcon() {
  return (
    <svg {...shared}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-2.82-1.17l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.26 14H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.17-2.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 10 3.26V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.74 10H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}

export function BackIcon() {
  return (
    <svg {...shared}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg {...shared}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function MinusIcon() {
  return (
    <svg {...shared}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg {...shared} width={20} height={20}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )
}

export function PencilIcon() {
  return (
    <svg {...shared} width={20} height={20}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

export function ListIcon() {
  return (
    <svg {...shared}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}

export function ChevronIcon() {
  return (
    <svg {...shared} width={20} height={20}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

export function ChevronDownIcon() {
  return (
    <svg {...shared} width={20} height={20} className="shrink-0">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg {...shared} width={20} height={20} className="shrink-0">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

export function BellIcon() {
  return (
    <svg {...shared}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg {...shared} width={20} height={20}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg {...shared}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}
