import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'

// issue #6：表情包回源路由读取 ctx.router——@cordisjs/plugin-server 的
// alias("server", ["router"]) 在 provide 之后早退，router 别名从未注册，
// ctx.router 恒为 undefined → 路由从未注册，分容器部署图片投递 retcode 100。
// 修复：读取 ctx.server（官方 plugin-console 同款实践）。

type Handler = (koa: unknown) => Promise<void>

function makeSvc(overrides: Record<string, unknown> = {}) {
  const routes = new Map<string, Handler>()
  const server = {
    get(path: string, handler: Handler) { routes.set(path, handler) },
  }
  const svc = {
    stickerRouteRegistered: false,
    ctx: { server, baseDir: process.cwd() },
    stickerById: new Map(),
    stickerConfig: { directory: 'data/hds-interlude/stickers' },
    reportStandaloneOperation: () => {},
    stickerDeliveryBase: () => 'http://127.0.0.1:5140',
    ...overrides,
  } as unknown as InterludeService
  return { svc, routes }
}

test('issue#6 路由注册在 ctx.server 上；未知素材 404；重复调用幂等', async () => {
  const { svc, routes } = makeSvc()
  ;(InterludeService.prototype as any).registerStickerRoute.call(svc)
  const handler = routes.get('/hds-interlude/sticker/:assetId')
  assert.ok(handler, '路由已注册到 ctx.server')
  assert.equal((svc as any).stickerRouteRegistered, true, '注册标志置位')

  // 已注册的素材不存在 → 404（不触碰文件系统）
  const koa: { params: { assetId: string }, status: number, type: string, body: unknown, set: () => void } = {
    params: { assetId: 'missing' }, status: 0, type: '', body: undefined, set: () => {},
  }
  await handler(koa)
  assert.equal(koa.status, 404, '未知/非活动素材返回 404')

  // 幂等：二次调用不再注册
  let double = false
  ;(svc as any).ctx.server.get = () => { double = true }
  ;(InterludeService.prototype as any).registerStickerRoute.call(svc)
  assert.equal(double, false, '已注册后跳过')
})

test('issue#6 无 server 优雅降级；只有死别名 router 时不再误判可用', () => {
  // 宿主未加载 server：不抛、不置位
  const { svc: noServer } = makeSvc({ ctx: { baseDir: process.cwd() } })
  ;(InterludeService.prototype as any).registerStickerRoute.call(noServer)
  assert.equal((noServer as any).stickerRouteRegistered, false, '无 server 不注册')

  // 修复前故障形态：只有 router 别名（实际恒 undefined）——现在同样视为不可用
  const { svc: routerOnly, routes } = makeSvc({ ctx: { router: { get: () => {} }, baseDir: process.cwd() } })
  ;(InterludeService.prototype as any).registerStickerRoute.call(routerOnly)
  assert.equal((routerOnly as any).stickerRouteRegistered, false, '不再读 ctx.router')
  assert.equal(routes.size, 0, '路由未注册到任何对象')
})

test('issue#6 加固：注册抛错时标志不置位（下次可重试）；realpath 拦截符号链接越界', async () => {
  // P2-3：server.get 抛出 → stickerRouteRegistered 保持 false
  const boom = makeSvc()
  ;(boom.svc as any).ctx.server = { get() { throw new Error('route conflict') } }
  assert.throws(() => (InterludeService.prototype as any).registerStickerRoute.call(boom.svc), /route conflict/)
  assert.equal((boom.svc as any).stickerRouteRegistered, false, '注册失败不置位，下次发送可重试')

  // P2-1：root 内符号链接指向目录外 → 404（resolve/relative 挡不住的形态）
  const os = await import('node:os')
  const fs = await import('node:fs')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdsi-symlink-'))
  try {
    const root = path.join(dir, 'stickers')
    const outside = path.join(dir, 'outside-secret.png')
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(outside, 'secret')
    fs.writeFileSync(path.join(root, 'real.png'), 'ok')
    // Windows 无管理员权限时文件符号链接 EPERM——用目录 junction（免权限）构造同形态
    const outsideDir = path.join(dir, 'outside-dir')
    fs.mkdirSync(outsideDir, { recursive: true })
    fs.writeFileSync(path.join(outsideDir, 'secret.png'), 'secret')
    fs.symlinkSync(outsideDir, path.join(root, 'escape-dir'), 'junction')
    const { realpathSync } = await import('node:fs')
    const { relative, resolve, sep } = await import('node:path')
    // 复现处理器内的判定逻辑（与 src 同式）：realpath 后越界
    const check = (filePath: string) => {
      let realFile: string, realRoot: string
      try { realRoot = realpathSync(root); realFile = realpathSync(resolve(root, filePath)) } catch { return false }
      const inside = relative(realRoot, realFile)
      return !!inside && inside !== '..' && !inside.startsWith(`..${sep}`) && !inside.includes(':')
    }
    assert.equal(check('real.png'), true, 'root 内真实文件放行')
    assert.equal(check(path.join('escape-dir', 'secret.png')), false, 'junction 指向目录外被拦截')
    assert.equal(check('../../outside-secret.png'), false, '路径穿越被拦截')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
