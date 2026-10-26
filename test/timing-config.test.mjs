/**
 * 同步节奏配置测试：debounceMs / idleMs 能存能取，且有上下限。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-sync-timing-'))
const HOME = join(ROOT, 'home')
let pass = 0, fail = 0
const ok = (c, l) => { c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l)) }

mkdirSync(HOME, { recursive: true })
writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ cloudDir: 'D:/x' }))
process.env.DSH_HOME = HOME

const host = (await import('../lib/index.js')).default
const routes = new Map()
host.apply({
  effect(fn) { fn(); return () => {} },
  webServer: { register(r) { routes.set(r.path, r.handler); return () => {} } },
  agents: { list: () => [] },
})

async function post(body) {
  const s = JSON.stringify(body)
  const req = { method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from(s) } }
  let out = ''
  await routes.get('/dsh-sync/config')(req, { writeHead() {}, end(c) { if (c) out += c } })
  return JSON.parse(out)
}

console.log('\n[保存节奏]')
const r1 = await post({ debounceMs: 12000, idleMs: 15000 })
ok(r1.ok === true, '保存成功')
ok(r1.saved.debounceMs === 12000, 'debounceMs = 12000')
ok(r1.saved.idleMs === 15000, 'idleMs = 15000')
const f1 = JSON.parse(readFileSync(join(HOME, 'dsh-sync.json'), 'utf8'))
ok(f1.debounceMs === 12000 && f1.idleMs === 15000, '落盘正确')

console.log('\n[上下限]')
const r2 = await post({ debounceMs: -5, idleMs: 9e9 })
ok(r2.saved.debounceMs === 0, '负数被夹到 0')
ok(r2.saved.idleMs === 600000, '超大值被夹到 600000（10 分钟）')

console.log('\n[小数]')
const r3 = await post({ debounceMs: 2500.7 })
ok(r3.saved.debounceMs === 2501, '小数四舍五入成整数毫秒')

rmSync(ROOT, { recursive: true, force: true })
console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)
