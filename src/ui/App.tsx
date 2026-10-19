// The editor. Top bar: File menu and the main actions on the left, the process name in the middle, Update /
// Help / Appearance (Aa) on the right. Below: the canvas (with the Check panel under it) and Properties or Help.
// Status bar: where the work is kept, what the check says, what is shown.
import { useEffect, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { AppearanceButton } from './Appearance'
import {
  BookOpen,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Download,
  FileDown,
  Image as ImageIcon,
  MoreHorizontal,
  FileText,
  FilePlus2,
  FolderOpen,
  GraduationCap,
  Info,
  LayoutDashboard,
  MessageSquare,
  MousePointer2,
  PanelRight,
  Play,
  RefreshCw,
  Smartphone,
  Sparkles,
  Timer,
  Save,
  TriangleAlert,
  X,
} from 'lucide-react'
import { summarize } from '../core/lint'
import { emptyModel, isArtifact } from '../core/metamodel'
import { deleteElements, nodeOf } from '../core/ops'
import { parseModel } from '../core/serialize'
import { applyUpdate, checkForUpdates, DEPLOY_DELAY_NOTE, installApp, updateCheckMessage, useUpdateReady } from '../pwa/register'
import { Canvas } from './canvas/Canvas'
import { TOOLS } from './canvas/Palette'
import { groupSelection, layoutNow, renameElement, ungroupSelection } from './actions'
import { exportImage } from './exportImage'
import { exportBpmn, openText, saveModel, saveModelAs } from './files'
import { FEEDBACK_URL } from './links'
import { Menu } from './Menu'
import { CheckPanel, issueSummary, useIssues } from './panels/Check'
import { HelpPanel } from './panels/Help'
import { Properties } from './panels/Properties'
import { SimulatePanel, useSim } from './panels/Simulate'
import { hadStoredModel, useEditor } from './store'
import { startTour, Tour } from './trainer/Tour'
import { TrainerPane, TrainerVeil } from './trainer/TrainerPane'
import { useTrainer } from './trainer/trainerStore'
import { PaneResizer, showSide, useLayout } from './viewport'
import { openWelcome, WelcomeCard, welcomeAtStart } from './Welcome'
import example from '../data/examples/library-loan.flow.json?raw'
import expenseAsIs from '../../cases/expense-claim-as-is.flow.json?raw'
import expenseToBe from '../../cases/expense-claim-to-be.flow.json?raw'

// First visit: the example, so the canvas is not empty; later visits: what was there before.
if (!hadStoredModel && !useEditor.getState().backup) useEditor.setState({ model: parseModel(example) })

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

const save = async (as: boolean) => {
  try {
    const note = await (as ? saveModelAs() : saveModel())
    if (note) useEditor.getState().say(note)
  } catch (e) {
    useEditor.getState().showError(`Not saved: ${(e as Error).message}`)
  }
}

const exportNow = async () => {
  try {
    useEditor.getState().say(await exportBpmn())
  } catch (e) {
    useEditor.getState().showError(`Not exported: ${(e as Error).message}`)
  }
}

const exportPicture = async (format: 'png' | 'svg') => {
  try {
    const name = await exportImage(format)
    if (name) useEditor.getState().say(`Exported ${name}: the whole diagram as an image, ready for slides and reports.`)
  } catch (e) {
    useEditor.getState().showError(`Not exported: ${(e as Error).message}`)
  }
}

const THEME_KEY = 'strataflow.theme'

/** The theme chosen last time, else the system's. */
function initialDark(): boolean {
  try {
    const t = localStorage.getItem(THEME_KEY)
    if (t === 'light' || t === 'dark') return t === 'dark'
  } catch {
    /* no storage */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches
}

export function App() {
  const doc = useEditor((s) => s.doc)
  const name = useEditor((s) => s.model.name)
  const error = useEditor((s) => s.error)
  const message = useEditor((s) => s.message)
  const help = useEditor((s) => s.help)
  const checkOpen = useEditor((s) => s.checkOpen)
  const simOpen = useSim((s) => s.open)
  const updateReady = useUpdateReady()
  const trainerOpen = useTrainer((s) => s.open)
  const inTask = useTrainer((s) => s.session !== null)
  const side = useLayout((s) => s.side)
  const narrow = useLayout((s) => s.narrow)
  const phone = useLayout((s) => s.phone)
  const trainerW = useLayout((s) => s.trainerW)
  const [dark, setDark] = useState(initialDark)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
    } catch {
      /* private mode: the theme follows the system next time */
    }
  }, [dark])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => useEditor.getState().say(null), 8000)
    return () => clearTimeout(t)
  }, [message])

  useEffect(() => {
    // On a phone the notice comes instead; the tour is one of the welcome card's choices.
    if (!useLayout.getState().phone) welcomeAtStart()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 's') {
        e.preventDefault()
        void save(e.shiftKey)
        return
      }
      if (mod && key === 'o') {
        e.preventDefault()
        input.current?.click()
        return
      }
      // In a text field the browser's own undo and keys apply.
      if (typing(e.target)) return
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (mod && key === 'g') {
        e.preventDefault()
        if (e.shiftKey) ungroupSelection()
        else groupSelection()
      } else if (mod && key === 'y') {
        e.preventDefault()
        s.redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length) {
        e.preventDefault()
        s.apply((m) => deleteElements(m, s.selection))
      } else if (e.key === 'Escape') {
        if (useLayout.getState().narrow) useLayout.getState().setSide(false)
        s.setTool({ id: 'select' })
        s.select([])
      } else if (e.key === 'F2' && s.selection.length === 1) {
        e.preventDefault()
        renameElement(s.selection[0])
      } else if (e.key === 'F1' || (e.key === '?' && !mod)) {
        e.preventDefault()
        s.openHelp(s.help ? null : 'index')
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find((x) => x.key.toLowerCase() === key)
        if (t) s.setTool(t.tool)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`app${phone ? ' is-phone' : ''}`} style={{ '--trainer-w': `${trainerW}px` } as React.CSSProperties}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <quaera-switcher app="flow" />
            <span className="stage-pill">preview</span>
          </div>
          <Menu
            label="File"
            testid="file-menu"
            items={[
              { label: 'New', icon: <FilePlus2 size={15} />, title: 'Start an empty process (Undo brings the last one back)', testid: 'new', onPick: () => useEditor.getState().load(emptyModel()) },
              { label: 'Open…', icon: <FolderOpen size={15} />, keys: 'Ctrl+O', title: 'Open a .flow.json file, or a .bpmn file (for example one exported from Bizagi Modeler)', testid: 'open', onPick: () => input.current?.click() },
              'sep',
              { label: 'Save', icon: <Save size={15} />, keys: 'Ctrl+S', title: 'Save as a .flow.json file', testid: 'save', onPick: () => void save(false) },
              { label: 'Save as…', keys: 'Ctrl+Shift+S', title: 'Choose where to save', testid: 'save-as', onPick: () => void save(true) },
              { label: 'Export BPMN', icon: <FileDown size={15} />, title: 'Export as BPMN 2.0 XML (.bpmn) for Bizagi Modeler, bpmn.io and other BPMN tools', testid: 'export-bpmn', onPick: () => void exportNow() },
              { label: 'Export PNG', icon: <ImageIcon size={15} />, title: 'The whole diagram as a PNG picture, for slides and reports', testid: 'export-png', onPick: () => void exportPicture('png') },
              { label: 'Export SVG', icon: <ImageIcon size={15} />, title: 'The whole diagram as an SVG picture (sharp at any size)', testid: 'export-svg', onPick: () => void exportPicture('svg') },
              'sep',
              {
                label: 'Open the example',
                icon: <BookOpen size={15} />,
                title: 'A library lends a book (Undo brings your process back)',
                testid: 'example',
                onPick: () => {
                  useEditor.getState().load(parseModel(example))
                  useEditor.getState().say('Opened the example: a library lends a book. Undo brings your process back.')
                },
              },
              {
                label: 'Example: expense claim AS-IS',
                icon: <Timer size={15} />,
                title: 'A paper expense claim with its times and costs: open Simulate to see the cycle time',
                testid: 'example-as-is',
                onPick: () => {
                  useEditor.getState().load(parseModel(expenseAsIs))
                  useSim.setState({ open: true, tab: 'figures', play: null })
                  useEditor.getState().say('Opened the AS-IS expense claim. Keep as AS-IS, then open the TO-BE (or change this one) to compare. Undo brings your process back.')
                },
              },
              {
                label: 'Example: expense claim TO-BE',
                icon: <Timer size={15} />,
                title: 'The redesigned expense claim: an app, triage, parallel checks, weekly payments',
                testid: 'example-to-be',
                onPick: () => {
                  useEditor.getState().load(parseModel(expenseToBe))
                  useSim.setState({ open: true, tab: 'figures', play: null })
                  useEditor.getState().say('Opened the TO-BE expense claim. With AS-IS kept, each figure shows the change. Undo brings your process back.')
                },
              },
            ]}
          />
          <input
            ref={input}
            type="file"
            accept=".json,.bpmn,.xml"
            hidden
            data-testid="open-input"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) await openText(await f.text(), f.name)
              e.target.value = ''
            }}
          />
          <button className="btn" onClick={() => void layoutNow()} title="Auto layout: steps left to right, each in its own lane (Undo puts everything back)" data-testid="auto-layout">
            <LayoutDashboard size={15} /> <span className="btn-label">Auto layout</span>
          </button>
          <CheckButton />
          <button
            className={`btn${simOpen ? ' is-open' : ''}`}
            onClick={() => useSim.getState().setOpen(!simOpen)}
            title="Simulate: play a case step by step; times, costs and how busy each lane is (AS-IS vs TO-BE)"
            data-testid="simulate"
          >
            <Timer size={15} /> <span className="btn-label">Simulate</span>
          </button>
          <button
            className={`btn${trainerOpen ? ' is-open' : ''}`}
            onClick={() => useTrainer.getState().setOpen(!trainerOpen)}
            title="Trainer: cases from easy to hard (worked example, tag the text, complete, build yourself) and lessons"
            data-testid="trainer"
          >
            <GraduationCap size={15} /> <span className="btn-label">Trainer</span>{inTask && <span className="count is-task">task</span>}
          </button>
        </div>
        <button className="topbar-file" title="The process: click to see and rename it" onClick={() => {
            useEditor.setState({ selection: [], help: null })
            showSide()
          }}
          data-testid="doc-name"
        >
          {name || 'Untitled process'}
        </button>
        <div className="topbar-right">
          {updateReady && (
            <button className="btn accent" onClick={applyUpdate} title="A new version of Quaera Flow is ready: reload to use it (your process is kept)" data-testid="update">
              <RefreshCw size={15} /> Update
            </button>
          )}
          <div className="topbar-more">
            <Menu
              label=""
              icon={<MoreHorizontal size={15} />}
              testid="more-menu"
              items={[
                { label: 'Auto layout', icon: <LayoutDashboard size={15} />, title: 'Steps left to right, each in its own lane (Undo puts everything back)', testid: 'more-layout', onPick: () => void layoutNow() },
                { label: 'Check', icon: <CircleCheck size={15} />, title: 'Open or close the Check panel', testid: 'more-check', onPick: () => useEditor.getState().setCheckOpen(!checkOpen) },
                { label: 'Simulate', icon: <Timer size={15} />, title: 'Play a case; times, costs and lane load', testid: 'more-simulate', onPick: () => useSim.getState().setOpen(!simOpen) },
                { label: 'Trainer', icon: <GraduationCap size={15} />, title: 'Cases from easy to hard, and lessons', testid: 'more-trainer', onPick: () => useTrainer.getState().setOpen(!trainerOpen) },
              ]}
            />
          </div>
          <Menu
            label="Help"
            icon={<CircleHelp size={15} />}
            testid="help-menu"
            items={[
              { label: 'Help cards', icon: <BookOpen size={15} />, keys: 'F1', title: 'BPMN ideas one by one: elements, rules, typical mistakes', testid: 'help-cards', onPick: () => useEditor.getState().openHelp('index') },
              { label: 'Welcome', icon: <Sparkles size={15} />, title: 'Where to start: lessons, a process built step by step, cases, a Bizagi file', testid: 'welcome-menu', onPick: openWelcome },
              { label: 'Tour', icon: <Play size={15} />, title: 'Six stops: drawing, files, check, trainer, help', testid: 'tour-menu', onPick: startTour },
              { label: 'How to draw', icon: <MousePointer2 size={15} />, title: 'Shortcuts and gestures (in Properties when nothing is selected)', onPick: () => {
                  useEditor.setState({ selection: [], help: null })
                  showSide()
                },
              },
              ...(FEEDBACK_URL
                ? [{ label: 'Send feedback…', icon: <MessageSquare size={15} />, title: 'Stuck or found a mistake? A short form, no account needed', testid: 'feedback', onPick: () => window.open(FEEDBACK_URL, '_blank', 'noopener') }]
                : []),
              'sep',
              {
                label: 'Check for updates',
                icon: <RefreshCw size={15} />,
                title: DEPLOY_DELAY_NOTE,
                testid: 'check-updates',
                onPick: async () => {
                  useEditor.getState().say('Checking for updates…')
                  useEditor.getState().say(updateCheckMessage(await checkForUpdates(), __APP_VERSION__))
                },
              },
              {
                label: 'Install as app',
                icon: <Download size={15} />,
                title: 'Its own window; works without Wi-Fi',
                onPick: async () => {
                  const note = await installApp()
                  if (note) useEditor.getState().say(note)
                },
              },
              {
                label: 'Third-party licences',
                icon: <FileText size={15} />,
                title: 'The open-source packages Quaera Flow uses, with their licence texts',
                testid: 'licences',
                onPick: () => window.open('./third-party-licenses.txt', '_blank', 'noopener'),
              },
              {
                label: `About · v${__APP_VERSION__}`,
                icon: <Info size={15} />,
                onPick: () =>
                  useEditor
                    .getState()
                    .say(`Quaera Flow ${__APP_VERSION__}: learn BPMN process modeling, part of Quaera (quaera.app). Unofficial student project. Code Apache-2.0, learning content CC BY-NC-SA 4.0; open-source packages: Help → Third-party licences. BPMN is an OMG standard; Bizagi is a trademark of its owner, Quaera Flow is not affiliated with it.`),
              },
            ]}
          />
          <button
            className={`btn icon${side ? ' is-open' : ''}`}
            onClick={() => useLayout.getState().setSide(!side)}
            title={side ? 'Hide Properties and help' : 'Show Properties and help'}
            aria-label="Properties and help"
            data-testid="side-toggle"
          >
            <PanelRight size={15} />
          </button>
          <AppearanceButton dark={dark} onToggleTheme={() => setDark((d) => !d)} />
        </div>
      </header>
      {(error || message) && (
        <div className={`notice${error ? ' is-error' : ''}`} role="status" data-testid="notice">
          {error && <TriangleAlert size={14} />}
          <span>{error || message}</span>
          <button className="notice-close" aria-label="Close" onClick={() => useEditor.setState({ error: null, message: null })}>
            <X size={14} />
          </button>
        </div>
      )}
      <main className="main">
        {trainerOpen && (
          <>
            <TrainerPane />
            {!phone && <PaneResizer />}
          </>
        )}
        <ReactFlowProvider key={doc}>
          <div className="workspace">
            <Canvas />
            <TrainerVeil />
            {checkOpen && <CheckPanel />}
            {simOpen && <SimulatePanel />}
          </div>
        </ReactFlowProvider>
        {side && (
          <div className={`side-wrap${narrow ? ' is-over' : ''}`}>
            {narrow && !help && (
              <button className="side-close" aria-label="Close" title="Close (Esc)" onClick={() => useLayout.getState().setSide(false)} data-testid="side-close">
                <X size={15} />
              </button>
            )}
            {help ? <HelpPanel id={help} /> : <Properties />}
          </div>
        )}
      </main>
      <StatusBar />
      <Tour />
      <PhoneNotice />
      <WelcomeCard onOpenFile={() => input.current?.click()} />
    </div>
  )
}

/** On a phone: the app is made for a bigger screen; what works here is reading. Asked once per browser. */
function PhoneNotice() {
  const phone = useLayout((s) => s.phone)
  const ok = useLayout((s) => s.phoneOk)
  if (!phone || ok) return null
  const go = (then?: () => void) => {
    useLayout.getState().continueOnPhone()
    then?.()
  }
  return (
    <div className="phone-notice" role="dialog" aria-modal="true" aria-labelledby="phone-notice-title" data-testid="phone-notice">
      <div className="phone-card">
        <Smartphone size={28} className="phone-icon" />
        <h2 id="phone-notice-title">Best on a laptop or a tablet</h2>
        <p>Drawing a process needs room: pools, lanes and the tools beside them do not fit on a phone screen.</p>
        <p>On a phone you can read the help cards and the lessons.</p>
        <div className="phone-actions">
          <button className="btn accent" onClick={() => go(() => useEditor.getState().openHelp('index'))} data-testid="phone-help">
            <BookOpen size={15} /> Help cards
          </button>
          <button className="btn" onClick={() => go(() => useTrainer.getState().setOpen(true))} data-testid="phone-lessons">
            <GraduationCap size={15} /> Lessons
          </button>
          <button className="btn" onClick={() => go()} data-testid="phone-continue">
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  )
}

/** Opens and closes the Check panel; the badge counts errors and warnings. */
function CheckButton() {
  const open = useEditor((s) => s.checkOpen)
  const c = summarize(useIssues())
  const worst = c.error ? 'error' : c.warning ? 'warning' : null
  return (
    <button
      className={`btn${open ? ' is-open' : ''}`}
      onClick={() => useEditor.getState().setCheckOpen(!open)}
      title="Check the model: every step reachable, splits closed by matching joins, names (course rules P01–P18)"
      data-testid="check"
    >
      {worst ? <TriangleAlert size={15} className={`is-${worst}`} /> : <CircleCheck size={15} className="is-ok" />} <span className="btn-label">Check</span>
      {worst && <span className={`count is-${worst}`}>{c.error + c.warning}</span>}
    </button>
  )
}

/** Left: where the work is kept. Centre: what the check says. Right: what is shown, and the version. */
function StatusBar() {
  const savedAt = useEditor((s) => s.savedAt)
  const backup = useEditor((s) => s.backup !== null)
  const model = useEditor((s) => s.model)
  const page = useEditor((s) => s.page)
  const selection = useEditor((s) => s.selection)
  const issues = useIssues()
  const c = summarize(issues)
  const where = page ? nodeOf(model, page)?.name || 'Sub-process' : 'Main process'
  const steps = model.nodes.filter((n) => !isArtifact(n)).length
  return (
    <footer className="statusbar">
      <span className="status-left" title="Every change is kept in this browser. File → Save writes a file you can move or hand in.">
        {backup ? 'Trainer task · your own process waits until you leave it' : savedAt ? `Kept in this browser · ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Kept in this browser'}
      </span>
      <button className="status-check" onClick={() => useEditor.getState().setCheckOpen(!useEditor.getState().checkOpen)} title="Open or close the Check panel" data-testid="status-check">
        {c.error ? <CircleAlert size={13} className="is-error" /> : c.warning ? <TriangleAlert size={13} className="is-warning" /> : <CircleCheck size={13} className="is-ok" />}
        {issueSummary(issues)}
      </button>
      <span className="status-right">
        {where} · {steps} steps{selection.length ? ` · ${selection.length} selected` : ''} · v{__APP_VERSION__}
      </span>
    </footer>
  )
}
