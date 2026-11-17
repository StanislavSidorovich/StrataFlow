// The simulation worker (stage 6b phase 3). The page starts it with `new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })`;
// Cancel is `worker.terminate()` on the page. The job itself is in simWorkerCore.ts.
import type { FromWorker, ToWorker } from './simProtocol'
import { runJob } from './simWorkerCore'

const scope = self as unknown as { onmessage: ((e: MessageEvent<ToWorker>) => void) | null; postMessage: (m: FromWorker) => void }
scope.onmessage = (e) => {
  if (e.data?.type === 'run') runJob(e.data, (m) => scope.postMessage(m))
}
