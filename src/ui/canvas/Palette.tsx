// The floating draw bar: pick a tool (or press its key), then click on the canvas to place it.
// Shift+click keeps the tool for the next element; Esc goes back to selecting.
import { MousePointer2 } from 'lucide-react'
import { useEditor, type Tool } from '../store'
import { BpmnIcon, type IconName } from './icons'

export const TOOLS: { tool: Tool; icon: IconName | 'select'; label: string; key: string }[] = [
  { tool: { id: 'select' }, icon: 'select', label: 'Select and move', key: 'V' },
  { tool: { id: 'task', spec: { type: 'task' } }, icon: 'task', label: 'Task', key: 'T' },
  { tool: { id: 'subProcess', spec: { type: 'subProcess' } }, icon: 'subProcess', label: 'Sub-process', key: 'U' },
  { tool: { id: 'start', spec: { type: 'event', position: 'start' } }, icon: 'start', label: 'Start event', key: 'S' },
  { tool: { id: 'intermediate', spec: { type: 'event', position: 'intermediate' } }, icon: 'intermediate', label: 'Intermediate event', key: 'I' },
  { tool: { id: 'end', spec: { type: 'event', position: 'end' } }, icon: 'end', label: 'End event', key: 'E' },
  { tool: { id: 'gateway', spec: { type: 'gateway' } }, icon: 'gateway', label: 'Gateway', key: 'G' },
  { tool: { id: 'dataObject', spec: { type: 'dataObject' } }, icon: 'dataObject', label: 'Data object', key: 'D' },
  { tool: { id: 'dataStore', spec: { type: 'dataStore' } }, icon: 'dataStore', label: 'Data store', key: 'B' },
  { tool: { id: 'annotation', spec: { type: 'annotation' } }, icon: 'annotation', label: 'Text annotation', key: 'N' },
  { tool: { id: 'pool' }, icon: 'pool', label: 'Pool (add lanes in Properties)', key: 'P' },
]

export function Palette() {
  const active = useEditor((s) => s.tool.id)
  return (
    <div className="palette" data-testid="palette" role="toolbar" aria-label="Draw">
      {TOOLS.map((t) => (
        <button
          key={t.tool.id}
          className={`palette-btn${active === t.tool.id ? ' is-active' : ''}`}
          title={`${t.label} (${t.key})`}
          aria-label={t.label}
          aria-pressed={active === t.tool.id}
          data-testid={`tool-${t.tool.id}`}
          onClick={() => useEditor.getState().setTool(t.tool)}
        >
          {t.icon === 'select' ? <MousePointer2 size={16} /> : <BpmnIcon name={t.icon} />}
        </button>
      ))}
    </div>
  )
}
