// Registers the service worker (production build only) and reports when a new
// version is waiting, so the toolbar can offer "Update".
import { useSyncExternalStore } from 'react'

let waiting: ServiceWorker | null = null
const listeners = new Set<() => void>()

let registration: ServiceWorkerRegistration | null = null
let lastCheck = Date.now()

function setWaiting(sw: ServiceWorker | null) {
  waiting = sw
  listeners.forEach((l) => l())
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const track = (sw: ServiceWorker | null) => {
          // A first install has no controller: nothing to update, the page is already current.
          if (!sw || !navigator.serviceWorker.controller) return
          if (sw.state === 'installed') setWaiting(sw)
          else sw.addEventListener('statechange', () => sw.state === 'installed' && setWaiting(sw))
        }
        // The browser may have found the new version while this page was loading.
        track(reg.waiting ?? reg.installing)
        reg.addEventListener('updatefound', () => track(reg.installing))
        // A tab left open for days still learns about new deploys.
        setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000)
        // Coming back to the tab is the moment a new deploy is most likely: look then, at most once a minute.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 60 * 1000) return
          lastCheck = Date.now()
          void reg.update().catch(() => {})
        })
        registration = reg
      })
      .catch(() => {})
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !waiting) return
      reloading = true
      location.reload()
    })
  })
}

export function applyUpdate() {
  waiting?.postMessage('SKIP_WAITING')
}

export type UpdateCheck = 'latest' | 'update' | 'failed' | 'unavailable'

/** The "Check for updates" item: fetches sw.js now and waits for a new version to finish installing. */
export async function checkForUpdates(): Promise<UpdateCheck> {
  if (!registration) return 'unavailable'
  lastCheck = Date.now()
  if (waiting) return 'update'
  try {
    await registration.update()
  } catch {
    return 'failed'
  }
  // The new worker can appear a moment after update() resolves.
  if (!registration.installing && !registration.waiting) await new Promise((done) => setTimeout(done, 1000))
  const installing = registration.installing
  if (installing) {
    await new Promise<void>((done) => {
      const finished = () => (installing.state === 'installed' || installing.state === 'redundant') && done()
      installing.addEventListener('statechange', finished)
      setTimeout(done, 30 * 1000)
      finished()
    })
  }
  // Read it from the registration: our statechange listener may run before the one that sets `waiting`.
  if (registration.waiting) {
    setWaiting(registration.waiting)
    return 'update'
  }
  return 'latest'
}

/** Why a fresh deploy takes a few minutes to show up; GitHub Pages' cache cannot be bypassed. */
export const DEPLOY_DELAY_NOTE = 'After a deploy, the new version shows up within a few minutes: GitHub Pages keeps files cached for up to 10 minutes.'

export function updateCheckMessage(result: UpdateCheck, version: string): string {
  switch (result) {
    case 'unavailable':
      return 'Updates work only in the published build, not in the development server.'
    case 'failed':
      return 'Could not check for updates. You are probably offline; try again when you are back online.'
    case 'update':
      return 'A new version is ready. Press Update at the top to switch to it.'
    default:
      return `You have the latest version (v${version}). ${DEPLOY_DELAY_NOTE}`
  }
}

export function useUpdateReady() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => waiting !== null,
  )
}

// Install as an app (Chrome, Edge, Samsung Internet): the browser offers the prompt once the page
// qualifies; we keep it for Help → Install as app. Safari and Firefox have no prompt: the menu shows how.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let installPrompt: InstallPrompt | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installPrompt = e as InstallPrompt
  })
  window.addEventListener('appinstalled', () => (installPrompt = null))
}

/** True when StrataFlow already runs as an installed app (its own window, no address bar). */
export const runsAsApp = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

/** Opens the browser's install dialog when it has one; otherwise returns what to do by hand. */
export async function installApp(): Promise<string | null> {
  if (runsAsApp()) return 'Quaera Flow is already installed: this window is the app. It works without Wi-Fi once opened online.'
  if (installPrompt) {
    const p = installPrompt
    installPrompt = null
    await p.prompt()
    const { outcome } = await p.userChoice
    return outcome === 'accepted' ? 'Installed. Open Quaera Flow from the home screen or the app list — it works without Wi-Fi.' : null
  }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios
    ? 'To install on an iPad: Safari → Share (□↑) → Add to Home Screen. It then works without Wi-Fi.'
    : 'To install: open the browser menu (⋮) → Install app (or Add to Home screen). In Chrome or Edge on a computer it is also the install icon in the address bar. The app works without Wi-Fi.'
}
