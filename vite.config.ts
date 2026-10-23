import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // relative asset paths: the build works at any URL prefix (e.g. GitHub Pages /<repo>/)
  base: './',
  plugins: [react(), tailwindcss()],
})
