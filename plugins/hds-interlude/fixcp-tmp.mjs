import { readFileSync, writeFileSync } from 'node:fs'

// ConfigPage: 把 null 守卫改为合并进 !result.ok 检查（不改变正常流程）
let cp = readFileSync('client/src/pages/ConfigPage.vue', 'utf8')
const oldBlock = `    const result = await store.readConfig(id)
      if (!result) { notice.value = 'Console 连接尚未就绪'; noticeKind.value = 'warn'; loading.value = false; return }
if (!result.ok) throw new Error(result.error ?? '读取失败')`
const newBlock = `    const result = await store.readConfig(id)
    if (!result || !result.ok) throw new Error(result?.error ?? 'Console 连接尚未就绪')`
if (!cp.includes(oldBlock)) throw new Error('ConfigPage pattern not found')
cp = cp.replace(oldBlock, newBlock)
writeFileSync('client/src/pages/ConfigPage.vue', cp)
console.log('ConfigPage guard merged')

// ActionsPage: REASONS 修 'not-found' → '记录已移除'
let ap = readFileSync('client/src/pages/ActionsPage.vue', 'utf8')
ap = ap.replace("'not-found': '未找到该动作'", "'not-found': '记录已移除或不存在'")
writeFileSync('client/src/pages/ActionsPage.vue', ap)
console.log('REASONS not-found fixed')
