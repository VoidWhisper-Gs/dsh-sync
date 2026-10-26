/**
 * 未配置云盘目录时的行为：不许推、不许拉，但要给出人话提示。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-sync-nocfg-'))
const HOME = join(ROOT, 'home')
let pass = 0, fail = 0
const ok = (c, l) => { c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l)) }

mkdirSync(join(HOME, 'sessions'), { recursive: true })
writeFileSync(join(HOME, 'sessions', 'a.txt'), 'a')
writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ auto: false, idleMs: 0 })) // 故意不填 cloudDir

process.env.DSH_HOME = HOME
const host = (await import('../lib/index.js')).default
const routes = new Map()
host.apply({
  effect(fn) { fn(); return () => {} },
  webServer: { register(r) { routes.set(r.path, r.handler); return () => {} } },
  agents: { list: () => [] },
})

function call(p) {
  let body = ''
  routes.get(p)({ headers: {}, method: 'GET' }, { writeHead() {}, end(c) { if (c) body += c } })
  return body ? JSON.parse(body) : null
}

console.log('\n[未配置]')
const st = call('/dsh-sync/status')
ok(st.ok === true, 'status 仍然正常返回')
ok(st.configured === false, 'configured: false')
ok(st.cloudDirExists === false, 'cloudDirExists: false')
ok(st.dirs.every((d) => d.cloud === ''), '目录的 cloud 字段是空串（不会乱拼）')
ok(st.total.pendingFiles === 0, '未配置时待同步为 0（不拿空路径去比）')

console.log('\n[拒绝]')
const p = call('/dsh-sync/push')
ok(p.ok === false && p.error === '还没设置云盘目录', 'push 拒绝并说明原因')
const q = call('/dsh-sync/pull')
ok(q.ok === false && q.error === '还没设置云盘目录', 'pull 同样拒绝')

rmSync(ROOT, { recursive: true, force: true })
console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)
