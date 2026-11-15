import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/** Console dynamically imports the default installer and resolves external modules.
 * A directory entry serves index.js together with style.css. Keep lazy pages in
 * one module so the host's entry URL also works without a separate chunk router. */
export default defineConfig(async () => ({
  plugins: [(await import('@vitejs/plugin-vue')).default()],
  build: {
    outDir: '../client-dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['vue', 'vue-router', '@koishijs/client'],
      output: { inlineDynamicImports: true },
    },
  },
}))
