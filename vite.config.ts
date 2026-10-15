/// <reference types="vitest/config" />
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// PWA without extra dependencies: emits sw.js with every built file in its precache list.
function pwaPlugin(): Plugin {
  return {
    name: 'strataflow-pwa',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = [...Object.keys(bundle), ...readdirSync('public')]
        .filter((f) => !f.endsWith('.map') && f !== 'sw.js')
        .sort()
      const hash = createHash('sha256')
      for (const f of Object.keys(bundle).sort()) {
        const out = bundle[f]
        hash.update(f).update(out.type === 'chunk' ? out.code : out.source)
      }
      for (const f of readdirSync('public').sort()) hash.update(f).update(readFileSync(`public/${f}`))
      const version = hash.digest('hex').slice(0, 12)
      const precache = ['./', ...files.map((f) => `./${f}`)]
      const source = readFileSync('src/pwa/sw.js', 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// Third-party notices: the licence text of every npm package that ends up in the bundle (MIT, ISC and BSD
// ask for their notice to travel with the code; elkjs's EPL-2.0 asks to say where its source is).
function noticesPlugin(): Plugin {
  return {
    name: 'strataflow-notices',
    apply: 'build',
    generateBundle() {
      const roots = new Set<string>()
      for (const id of this.getModuleIds()) {
        const m = id.replace(/\\/g, '/').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//)
        if (m) roots.add(m[1])
      }
      const parts = [...roots]
        .map((dir) => {
          const p = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as { name: string; version: string; license?: string; homepage?: string; repository?: string | { url: string } }
          const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(f))
          const repo = typeof p.repository === 'string' ? p.repository : p.repository?.url
          const source = p.name === 'elkjs' ? '\nSource code: https://github.com/kieler/elkjs (used unmodified, under EPL-2.0)\n' : ''
          return { name: p.name, text: `${p.name} ${p.version} · ${p.license ?? 'see below'}\n${p.homepage ?? repo ?? ''}${source}\n${file ? readFileSync(`${dir}/${file}`, 'utf8').trim() : `License: ${p.license}`}\n` }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((x) => x.text)
      const head = 'StrataFlow uses these open-source packages. Their licences and notices follow.\n'
      this.emitFile({ type: 'asset', fileName: 'third-party-licenses.txt', source: [head, ...parts].join(`\n${'-'.repeat(72)}\n\n`) })
    },
  }
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss(), noticesPlugin(), pwaPlugin()],
  // elkjs (auto layout) is one 1.4 MB chunk, loaded on the first Auto layout click only.
  build: { chunkSizeWarningLimit: 1500 },

  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
