/**
 * dsh-sync 写入版测试 —— 全程临时目录，绝不碰真实数据。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, utimesSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-sync-rw-'))
const HOME = join(ROOT, 'home')
const CLOUD = join(ROOT, 'cloud')

let pass = 0, fail = 0
const ok = (c, label) => { c ? (pass++, console.log('  ✓ ' + label)) : (fail++, console.log('  ✗ ' + label)) }

mkdirSync(join(HOME, 'sessions'), { recursive: true })
mkdirSync(join(HOME, 'fish-memory'), { recursive: true })
writeFileSync(join(HOME, 'sessions', 'a.txt'), 'AAA')
writeFileSync(join(HOME, 'fish-memory', 'm.json'), '{"m":1}')
writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ cloudDir: CLOUD, auto: false, idleMs: 0, allowPull: false }))

process.env.DSH_HOME = HOME
const host = (await import('../lib/index.js')).default

const routes = new Map()
const ctx = {
  effect(fn) { fn(); return () => {} },
  webServer: { register(r) { routes.set(r.path, r.handler); return () => {} } },
  agents: { list: () => [] },
}
host.apply(ctx)

function call(p, req = { headers: {} }) {
  const out = { body: '' }
  routes.get(p)(req, { writeHead() {}, end(c) { if (c) out.body += c } })
  return out.body ? JSON.parse(out.body) : null
}

console.log('\n[推送]')
let st = call('/dsh-sync/status')
ok(st.safeToPush === true, 'idleMs=0 → 判定安全')
ok(st.total.pendingFiles === 2, '待同步 2 个文件')

let r = call('/dsh-sync/push')
ok(r.ok === true, 'push 成功')
ok(r.copied === 2, '复制了 2 个文件（实收 ' + r.copied + '）')
ok(readFileSync(join(CLOUD, 'sessions', 'a.txt'), 'utf8') === 'AAA', '云盘内容正确')
ok(readFileSync(join(CLOUD, 'fish-memory', 'm.json'), 'utf8') === '{"m":1}', '第二个目录也对')

let r2 = call('/dsh-sync/push')
ok(r2.copied === 0, '再推一次：0 个（没有新东西）')

console.log('\n[安全判断]')
writeFileSync(join(HOME, 'sessions', 'a.txt'), 'AAA2')
writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ cloudDir: CLOUD, auto: false, idleMs: 60000 }))
st = call('/dsh-sync/status')
ok(st.safeToPush === false, '刚写完 + idleMs=60000 → 判定不安全')
const blocked = call('/dsh-sync/push')
ok(blocked.ok === false && blocked.error === '还没写完', 'push 被拦下（不会硬搬）')
ok(readFileSync(join(CLOUD, 'sessions', 'a.txt'), 'utf8') === 'AAA', '云盘内容没被改动')

console.log('\n[拉取]')
const noPull = call('/dsh-sync/pull')
ok(noPull.ok === false && noPull.error === '拉取未启用', '默认不允许拉取')

// 打开拉取，并把云盘那份改"新一点"
writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ cloudDir: CLOUD, auto: false, idleMs: 0, allowPull: true }))
writeFileSync(join(CLOUD, 'sessions', 'a.txt'), 'FROM-CLOUD')
const future = new Date(Date.now() + 5000)
utimesSync(join(CLOUD, 'sessions', 'a.txt'), future, future)

const pulled = call('/dsh-sync/pull')
ok(pulled.ok === true, 'pull 成功')
ok(pulled.copied >= 1, '至少复制回 1 个文件')
ok(readFileSync(join(HOME, 'sessions', 'a.txt'), 'utf8') === 'FROM-CLOUD', '本地被更新成云盘版本')
ok(existsSync(pulled.backup), '备份目录已创建')
const backupDirs = readdirSync(pulled.backup)
ok(backupDirs.includes('sessions'), '备份里包含 sessions')

console.log('\n[状态文件]')
ok(existsSync(join(HOME, 'dsh-sync-state.json')), '状态文件已写')
const state = JSON.parse(readFileSync(join(HOME, 'dsh-sync-state.json'), 'utf8'))
ok(!!state.lastPushAt, '记录了 lastPushAt')
ok(!!state.lastPullAt, '记录了 lastPullAt')

rmSync(ROOT, { recursive: true, force: true })
console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)
