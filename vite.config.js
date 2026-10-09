import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Split large third-party libraries into stable, separately-cacheable chunks so
// the entry bundle stays small and vendor code survives app deploys in cache.
function manualChunks(id) {
  if (!id.includes('node_modules')) return undefined
  if (id.includes('firebase') || id.includes('@firebase')) return 'firebase'
  if (id.includes('react-router')) return 'router'
  if (id.includes('lucide-react')) return 'icons'
  if (id.includes('react-hot-toast')) return 'toast'
  if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
  return 'vendor'
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: { manualChunks },
    },
  },
  server: {
    port: 3000,
    open: true
  }
})

