import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'

/** HDSI Console 客户端构建：单入口 IIFE bundle，产出到 client-dist/。
 * Koishi Console 以运行时 addEntry 加载该文件（见 src/console/index.ts）。
 * plugin-vue 用动态 import 加载：根 node_modules 可能装到 ESM-only 的
 * v6（静态 require 会炸 vite 5 的 CJS 配置链），异步工厂对 v5/v6 都兼容。 */
export default defineConfig(async () => ({
  plugins: [
    (await import('@vitejs/plugin-vue')).default(),
    {
      name: 'hdsi-client-manifest',
      closeBundle() {
        // addEntry 需要一个 manifest 邻接文件
        mkdirSync(resolve(__dirname, '../client-dist'), { recursive: true })
        writeFileSync(resolve(__dirname, '../client-dist/index.yml'), [
          'version: 1',
          'entries:',
          "  hdsi-console: hdsi-console.js",
        ].join('\n'))
      },
    },
  ],
  build: {
    outDir: '../client-dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'index.ts'),
      formats: ['iife'],
      name: 'hdsiConsole',
      fileName: () => 'hdsi-console.js',
    },
    rollupOptions: {
      // vue/vue-router/@koishijs/client 由 Console 宿主提供
      external: ['vue', 'vue-router', '@koishijs/client'],
      output: { globals: { vue: 'Vue', 'vue-router': 'VueRouter', '@koishijs/client': 'KoishiClient' } },
    },
  },
}))
