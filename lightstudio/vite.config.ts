import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: '/home/z/my-project/lightstudio',
  css: {
    postcss: '/home/z/my-project/lightstudio/postcss.config.js',
  },
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          vendor: ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
})