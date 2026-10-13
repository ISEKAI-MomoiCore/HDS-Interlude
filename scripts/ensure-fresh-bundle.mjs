// 打包前防线：rc16/rc17 曾因只跑 tsc（emitDeclarationOnly）而打出旧 bundle。
// prepack 时校验 lib/index.js 不早于 src/ 下任何 .ts 文件，过期即拒绝打包。
import { statSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let bundleMtime
try {
  bundleMtime = statSync('lib/index.js').mtimeMs
} catch {
  console.error('[prepack] lib/index.js 不存在。请在工作区根目录运行 "npx yakumo build" 后再打包。')
  process.exit(1)
}

let newestSrc = 0
let newestFile = ''
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) walk(path)
    else if (item.name.endsWith('.ts')) {
      const mtime = statSync(path).mtimeMs
      if (mtime > newestSrc) { newestSrc = mtime; newestFile = path }
    }
  }
}
walk('src')

if (newestSrc > bundleMtime) {
  console.error(`[prepack] lib/index.js 落后于源码（最新改动：${newestFile}）。请在工作区根目录运行 "npx yakumo build" 后重新打包。`)
  process.exit(1)
}

// 形态防线（rc51 事故复盘）：运行时入口必须是 esbuild 的 CJS 自包含 bundle。
// 若 tsconfig 丢失 emitDeclarationOnly，tsc 会吐出 ESM 无扩展名导入的多文件产物，
// dumble 跳过打包——这种 lib 无法被 Node/Koishi 的任何 loader 加载，必须在打包瞬间拦下。
const bundle = readFileSync('lib/index.js', 'utf8')
if (/^\s*(import|export)\s/m.test(bundle.slice(0, 4096))) {
  console.error('[prepack] lib/index.js 是 ESM 产物而不是 CJS bundle（检测到顶层 import/export）。'
    + '请确认插件 tsconfig 继承工作区 tsconfig.base.json（emitDeclarationOnly），清理 lib 后在工作区根目录重新 "npx yakumo build"。')
  process.exit(1)
}
console.log('[prepack] bundle 新鲜度与 CJS 形态校验通过')
