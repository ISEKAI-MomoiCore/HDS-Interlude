import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'hdsi-webconsole-test-'))
  const file = join(directory, 'fixture.db')
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE interlude_story (id TEXT PRIMARY KEY, status TEXT, setting TEXT, state TEXT, cursorAt INTEGER, updatedAt INTEGER);
    CREATE TABLE interlude_script_entry (id INTEGER PRIMARY KEY, storyId TEXT, participantId TEXT, kind TEXT, actor TEXT, content TEXT, occurredAt INTEGER, metadata TEXT);
    CREATE TABLE interlude_scene (id INTEGER PRIMARY KEY, storyId TEXT, status TEXT, startedAt INTEGER, endedAt INTEGER, hook TEXT, summary TEXT, entryCount INTEGER);
    CREATE TABLE interlude_arc (id INTEGER PRIMARY KEY, storyId TEXT, status TEXT, title TEXT, summary TEXT, sceneCount INTEGER, updatedAt INTEGER);
    CREATE TABLE interlude_state_patch (id INTEGER PRIMARY KEY, storyId TEXT, participantId TEXT, target TEXT, path TEXT, proposedValue TEXT, evidence TEXT, confidence REAL, impact TEXT, status TEXT, sourceEntryIds TEXT, createdAt INTEGER, appliedAt INTEGER);
    CREATE TABLE interlude_overlay_snapshot (id INTEGER PRIMARY KEY, storyId TEXT, participantId TEXT, target TEXT, tier TEXT, periodStart INTEGER, periodEnd INTEGER, summary TEXT, majorEvents TEXT, sourcePatchIds TEXT, status TEXT);
    CREATE TABLE interlude_fact (id INTEGER PRIMARY KEY, storyId TEXT, scope TEXT, content TEXT, confidence REAL, unresolved INTEGER, sourceEntryIds TEXT, status TEXT);
    CREATE TABLE interlude_intent (id INTEGER PRIMARY KEY, storyId TEXT, type TEXT, summary TEXT, notBefore INTEGER, status TEXT, payload TEXT);
    CREATE TABLE interlude_memory (id INTEGER PRIMARY KEY, storyId TEXT, category TEXT, content TEXT, status TEXT);
    CREATE TABLE interlude_participant (id TEXT PRIMARY KEY, storyId TEXT, displayName TEXT, platform TEXT, status TEXT, state TEXT, updatedAt INTEGER);
    CREATE TABLE interlude_schedule_preplan (storyId TEXT PRIMARY KEY, revision INTEGER, timezone TEXT, validFrom TEXT, validThrough TEXT, lastReviewedLocalDate TEXT, lastEvidenceEntryId INTEGER, reviewReason TEXT, regimes TEXT, exceptions TEXT, materializedDays TEXT, updatedAt INTEGER);
    CREATE TABLE interlude_long_arc_guidance (id INTEGER PRIMARY KEY, storyId TEXT, version INTEGER, status TEXT, title TEXT, direction TEXT, updatedAt INTEGER);
  `)
  const insert = (table: string) => db.prepare('INSERT INTO ' + table + ' VALUES (' + db.prepare('PRAGMA table_info(' + table + ')').all().map(() => '?').join(',') + ')')
  const now = Date.parse('2026-10-08T10:00:00Z')
  const history = Array.from({ length: 16 }, (_, i) => ({ turn: i + 1, phase: 'advance', alter: i % 3 - 1, alterValue: Math.sin(i / 3) * 8, timestamp: new Date(now - (15 - i) * 3600000).toISOString(), participantId: i % 2 ? 'friend-a' : '' }))
  const state = { settingOverlay: { world: '街角的旧书店开门了。', relationship: '逐渐熟悉的邻居。' }, alterSystem: { alterValue: 4, alterWeight: 1, lastTriggerDirection: 0, emotionalOffset: null, history, pendingScopes: [{ participantId: 'friend-a', alterValue: 2 }] }, extensions: { urge: { pace: 'normal', value: .6 } }, automation: { nextAdvanceAt: new Date(now + 600000).toISOString() }, lifeRhythm: { attention: 'resting', basis: '午后的店里没有客人，靠在柜台后打盹。', assessedAt: new Date(now - 600000).toISOString(), source: 'compactor' }, proactiveContactLog: [{ at: new Date(now - 3600000).toISOString() }, { at: new Date(now - 7200000).toISOString() }] }
  const story = insert('interlude_story')
  story.run('demo-a', 'active', JSON.stringify({ timezone: 'Asia/Shanghai' }), JSON.stringify(state), now, now + 1)
  story.run('demo-b', 'active', '{}', '{}', now, now)
  const script = insert('interlude_script_entry')
  for (let i = 1; i <= 115; i++) script.run(i, 'demo-a', i % 2 ? 'friend-a' : '', i % 2 ? 'user-message' : 'script', 'demo', `测试剧本条目 ${i}（合成数据）`, now + i * 1000, JSON.stringify({ deliveryActions: [{ status: 'delivered', eventKind: 'message' }] }))
  script.run(116, 'demo-b', 'other', 'script', 'demo', '不得出现在故事 A', now, '{}')
  insert('interlude_scene').run(1, 'demo-a', 'active', now, null, '午后旧书店', '从一次偶遇开始的日常。', 40)
  insert('interlude_arc').run(1, 'demo-a', 'active', '街角日常', '在缓慢生活里发现新的联系。', 3, now)
  const patch = insert('interlude_state_patch')
  patch.run(1, 'demo-a', '', 'world', 'world', '旧书店\n暂时休息', '来源于原文', .9, 'minor', 'applied', '[1,2]', now - 200000, now - 180000)
  patch.run(2, 'demo-a', '', 'world', 'world', '旧书店\n重新开门', '来源于原文', .95, 'major', 'applied', '[3,4]', now - 100000, now - 90000)
  patch.run(3, 'demo-a', '', 'world', 'world', '提案尚未应用', '候选证据', .7, 'minor', 'proposed', '[5]', now, null)
  insert('interlude_overlay_snapshot').run(1, 'demo-a', '', 'world', 'weekly', now - 604800000, now, '一周内，旧书店从休息到恢复营业。', '["重新开门"]', '[1,2]', 'active')
  const fact = insert('interlude_fact')
  fact.run(1, 'demo-a', 'world', '旧书店位于街角', .9, 0, '[1]', 'active')
  fact.run(2, 'demo-a', 'relationship', '熟悉的邻居', .8, 1, '[2,3]', 'active')
  insert('interlude_intent').run(1, 'demo-a', '<img src=x onerror=alert(1)>', '以后可能去书店', now + 3600000, 'pending', '{}')
  insert('interlude_memory').run(1, 'demo-a', 'daily', '午后阳光', 'active')
  const participant = insert('interlude_participant')
  participant.run('friend-a', 'demo-a', '邻居（演示）', 'test', 'active', JSON.stringify({ unreadMessageCount: 1, relationshipOverlay: '成为偶尔一起喝茶的朋友。' }), now)
  participant.run('corrupt', 'demo-a', '损坏 JSON 测试', 'test', 'active', '{bad', now)
  participant.run('other', 'demo-b', '其他故事', 'test', 'active', '{}', now)
  const days = Array.from({ length: 14 }, (_, i) => ({ date: new Date(Date.parse('2026-10-05T00:00:00Z') + i * 86400000).toISOString().slice(0, 10), blocks: [{ id: `work-${i}`, start: '09:00', end: '17:00', label: '书店工作', kind: 'work', location: '街角' }, { id: `walk-${i}`, start: '18:30', end: '19:15', label: '散步候选', kind: 'leisure', tentative: true }] }))
  days.unshift({ date: '2026-10-04', blocks: [{ id: 'overnight', start: '23:00', end: '01:30', label: '跨午夜阅读', kind: 'rest' } as any] })
  insert('interlude_schedule_preplan').run('demo-a', 3, 'Asia/Shanghai', '2026-10-05', '2026-10-18', '2026-10-08', 100, '根据近期对话复查日常规律；仅为计划。', '[]', JSON.stringify([{ date: '2026-10-08', mode: 'patch', reason: '晚间可能有临时安排' }]), JSON.stringify(days), now)
  insert('interlude_long_arc_guidance').run(1, 'demo-a', 1, 'active', '街角关系', '保持自然的日常交往', now)
  let closed = false
  return { file, db, now, close() { if (closed) return; closed = true; db.close(); for (const name of readdirSync(directory)) unlinkSync(join(directory, name)); rmdirSync(directory) } }
}



