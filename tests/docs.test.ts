// Several processes open at once: tabs park and restore a process with its own undo history, nothing leaks between them.
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import { addPool, setModelName } from '../src/core/ops'
import { closeTab, MAX_TABS, newProcess, openProcess, reopenClosed, switchTo, useDocs } from '../src/ui/docs'
import { useEditor } from '../src/ui/store'

const drawn = (name: string): FlowModel => {
  const m = emptyModel(name)
  addPool(m, { x: 0, y: 0 })
  return m
}
const idsOf = () => useDocs.getState().tabs.map((t) => t.id)
const names = () => useDocs.getState().tabs.map((t) => (t.id === useDocs.getState().active ? useEditor.getState().model.name : useDocs.getState().parked[t.id].model.name))

beforeEach(() => {
  useDocs.setState({ tabs: [{ id: 't0' }], active: 't0', parked: {}, closed: [] })
  useEditor.setState({ model: emptyModel('Start'), past: [], future: [], selection: [], page: null, backup: null, doc: 0 })
})

describe('tabs', () => {
  it('reuses an empty untouched tab for the first process', () => {
    openProcess(drawn('A'))
    expect(useDocs.getState().tabs).toHaveLength(1)
    expect(useEditor.getState().model.name).toBe('A')
  })

  it('opens the next process beside the first, which stays open', () => {
    openProcess(drawn('A'))
    openProcess(drawn('B'))
    expect(names()).toEqual(['A', 'B'])
    expect(useEditor.getState().model.name).toBe('B')
  })

  it('keeps each process own undo history and selection', () => {
    openProcess(drawn('A'))
    const loaded = useEditor.getState().past.length // opening in the empty tab is itself undoable
    useEditor.getState().apply((m) => setModelName(m, 'A2'))
    expect(useEditor.getState().past).toHaveLength(loaded + 1)
    openProcess(drawn('B'))
    expect(useEditor.getState().past).toHaveLength(0)
    const [a] = idsOf()
    switchTo(a)
    expect(useEditor.getState().model.name).toBe('A2')
    expect(useEditor.getState().past).toHaveLength(loaded + 1)
    useEditor.getState().undo()
    expect(useEditor.getState().model.name).toBe('A')
    switchTo(idsOf()[1])
    expect(useEditor.getState().model.name).toBe('B')
  })

  it('a switch is a new document for the canvas', () => {
    openProcess(drawn('A'))
    openProcess(drawn('B'))
    const before = useEditor.getState().doc
    switchTo(idsOf()[0])
    expect(useEditor.getState().doc).toBeGreaterThan(before)
  })

  it('closes a tab and shows its neighbour; Reopen brings it back', () => {
    openProcess(drawn('A'))
    openProcess(drawn('B'))
    openProcess(drawn('C'))
    switchTo(idsOf()[1])
    closeTab(useDocs.getState().active)
    expect(names()).toEqual(['A', 'C'])
    expect(useEditor.getState().model.name).toBe('C')
    reopenClosed()
    expect(names().sort()).toEqual(['A', 'B', 'C'])
    expect(useEditor.getState().model.name).toBe('B')
  })

  it('closing a background tab keeps the active one', () => {
    openProcess(drawn('A'))
    openProcess(drawn('B'))
    closeTab(idsOf()[0])
    expect(names()).toEqual(['B'])
    expect(useEditor.getState().model.name).toBe('B')
  })

  it('closing the last tab leaves an empty process that Undo brings back', () => {
    openProcess(drawn('A'))
    closeTab('t0')
    expect(useDocs.getState().tabs).toHaveLength(1)
    expect(useEditor.getState().model.nodes.length + useEditor.getState().model.participants.length).toBe(0)
    useEditor.getState().undo()
    expect(useEditor.getState().model.name).toBe('A')
  })

  it('stops at the tab limit', () => {
    for (let i = 0; i < MAX_TABS + 2; i++) openProcess(drawn(`P${i}`))
    expect(useDocs.getState().tabs).toHaveLength(MAX_TABS)
  })

  it('does nothing to the tabs during a trainer task; New ends the task as before', () => {
    openProcess(drawn('A'))
    openProcess(drawn('B'))
    useEditor.setState({ backup: drawn('mine') })
    switchTo(idsOf()[0])
    expect(useEditor.getState().model.name).toBe('B')
    closeTab(idsOf()[0])
    expect(useDocs.getState().tabs).toHaveLength(2)
    newProcess()
    expect(useEditor.getState().backup).toBeNull()
    expect(useDocs.getState().tabs).toHaveLength(2)
  })
})
