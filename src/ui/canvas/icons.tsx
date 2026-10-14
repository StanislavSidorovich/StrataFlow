// Small BPMN glyphs for the draw bar and the context pad (18 × 18, drawn in the current text colour).

export type IconName = 'task' | 'subProcess' | 'start' | 'intermediate' | 'end' | 'gateway' | 'parallel' | 'dataObject' | 'dataStore' | 'annotation' | 'pool' | 'boundary'

export function BpmnIcon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
      {GLYPHS[name]}
    </svg>
  )
}

const GLYPHS: Record<IconName, React.ReactNode> = {
  task: <rect x={1.5} y={4} width={15} height={10} rx={2.5} />,
  subProcess: (
    <>
      <rect x={1.5} y={3} width={15} height={12} rx={2.5} />
      <path d="M7 9.5h4M9 7.5v4" />
    </>
  ),
  start: <circle cx={9} cy={9} r={6.5} />,
  intermediate: (
    <>
      <circle cx={9} cy={9} r={7} />
      <circle cx={9} cy={9} r={5} />
    </>
  ),
  end: <circle cx={9} cy={9} r={6} strokeWidth={2.8} />,
  gateway: (
    <>
      <path d="M9 1.5L16.5 9L9 16.5L1.5 9Z" />
      <path d="M6.8 6.8l4.4 4.4M11.2 6.8l-4.4 4.4" />
    </>
  ),
  parallel: (
    <>
      <path d="M9 1.5L16.5 9L9 16.5L1.5 9Z" />
      <path d="M9 5.5v7M5.5 9h7" />
    </>
  ),
  dataObject: <path d="M4 1.5h7l3 3v12H4Z M11 1.5v3h3" />,
  dataStore: <path d="M3 4c0-2 12-2 12 0v10c0 2-12 2-12 0Z M3 4c0 2 12 2 12 0" />,
  annotation: <path d="M7 2.5H3.5v13H7 M9 6h6 M9 9h6 M9 12h4" />,
  pool: (
    <>
      <rect x={1} y={3.5} width={16} height={11} />
      <path d="M4.5 3.5v11" />
    </>
  ),
  boundary: (
    <>
      <rect x={1.5} y={2} width={15} height={10} rx={2.5} />
      <circle cx={12} cy={12} r={4} fill="var(--panel-bg)" />
      <path d="M12 10v2l1.4 1" />
    </>
  ),
}
