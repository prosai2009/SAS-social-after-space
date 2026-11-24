import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// New id on every build — the running app compares it against /version.json
// and reloads itself when a newer deploy is live (no hard refresh needed).
const BUILD_ID = Date.now().toString(36)

function versionFile() {
  return {
    name: 'sas-version-file',
    apply: 'build',
    writeBundle() {
      writeFileSync(resolve('dist', 'version.json'), JSON.stringify({ v: BUILD_ID }))
    },
  }
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), versionFile()],
  server: { port: 5173, host: true },
  build: {
    target: 'es2019',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          supabase: ['@supabase/supabase-js'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
