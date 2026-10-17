// Registers the service worker (production build only) and reports when a new
// version is waiting, so the toolbar can offer "Update".
import { useSyncExternalStore } from 'react'

let waiting: ServiceWorker | null = null
const listeners = new Set<() => void>()

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
        setInterval(() => void reg.update(), 60 * 60 * 1000)
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
