import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/radio/',
  server: {
    proxy: {
      '/radio/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
      '/radio/ws': {
        target: 'ws://localhost:5001',
        ws: true,
      },
    },
  },
})
