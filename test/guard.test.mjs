/**
 * dsh-sync 安全护栏测试
 * ----------------------------------------------------------------------------
 * 专门造「联接」和「云盘在数据目录里」这两种危险情况，验证插件会拒绝。
 * 全程临时目录。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-sync-guard-'))
const HOME = join(ROOT, 'home')
const CLOUD = join(ROOT, 'cloud')
const TARGET = join(ROOT, 'somewhere-else')

let pass = 0, fail = 0
const ok = (c, label) => { c ? (pass++, console.log('  ✓ ' + label)) : (fail++, console.log('  ✗ ' + label)) }

mkdirSync(join(HOME), { recursive: true })
mkdirSync(TARGET, { recursive: true })
writeFileSync(join(TARGET, 'x.txt'), 'x')

// 造一个真正的联接：home/sessions -> ROOT/somewhere-else
try {
  symlinkSync(TARGET, join(HOME, 'sessions'), 'junction')
  console.log('（已创建联接用于测试）')
} catch (e) {
  console.log('创建联接失败，跳过该组：' + e.message)
}

writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ cloudDir: CLOUD, auto: false, idleMs: 0, allowPull: true }))
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
  routes.get(p)({ headers: {} }, { writeHead() {}, end(c) { if (c) body += c } })
  return body ? JSON.parse(body) : null
}

console.log('\n[联接检测]')
const st = call('/dsh-sync/status')
ok(st.fatal === true, 'status 标了 fatal:true')
ok(Array.isArray(st.issues) && st.issues.length >= 1, 'issues 里有一条以上')
ok((st.issues || []).some((i) => i.dir === 'sessions'), '点名了 sessions 是联接')
console.log('    理由:', (st.issues || [])[0] && st.issues[0].problem)

console.log('\n[拒绝写入]')
const p = call('/dsh-sync/push')
ok(p.ok === false && p.error === '目录不安全', 'push 被拒绝')
const q = call('/dsh-sync/pull')
ok(q.ok === false && q.error === '目录不安全', 'pull 被拒绝')
ok(readFileSync(join(TARGET, 'x.txt'), 'utf8') === 'x', '目标目录没被写入')

console.log('\n[云盘在数据目录里]')
// 换一个正常目录，但把 cloudDir 指到 HOME 里面
rmSync(join(HOME, 'sessions'), { force: true })
mkdirSync(join(HOME, 'sessions'), { recursive: true })
writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ cloudDir: join(HOME, 'cloud-inside'), auto: false, idleMs: 0 }))
const st2 = call('/dsh-sync/status')
ok(st2.fatal === true, '云盘落在数据目录里 → fatal')
ok((st2.issues || []).some((i) => i.dir === 'cloudDir'), '点名了 cloudDir')

console.log('\n[正常情况]')
writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ cloudDir: CLOUD, auto: false, idleMs: 0 }))
const st3 = call('/dsh-sync/status')
ok(st3.fatal === false, '正常目录 + 外部云盘 → 没有 fatal')
ok((st3.issues || []).length === 0, 'issues 为空')

rmSync(ROOT, { recursive: true, force: true })
console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)
