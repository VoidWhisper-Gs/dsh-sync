/**
 * 面板页测试：确认 /dsh-sync/panel 返回一份能用的 HTML，且状态接口还在。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-sync-panel-'))
const HOME = join(ROOT, 'home')
const CLOUD = join(ROOT, 'cloud')
let pass = 0, fail = 0
const ok = (c, l) => { c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l)) }

mkdirSync(join(HOME, 'sessions'), { recursive: true })
writeFileSync(join(HOME, 'sessions', 'a.txt'), 'a')
writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ cloudDir: CLOUD, auto: false, idleMs: 0 }))
process.env.DSH_HOME = HOME

const host = (await import('../lib/index.js')).default
const routes = new Map()
host.apply({
  effect(fn) { fn(); return () => {} },
  webServer: { register(r) { routes.set(r.path, r.handler); return () => {} } },
  agents: { list: () => [] },
})

function call(p) {
  const out = { status: 0, headers: {}, body: '' }
  routes.get(p)({ headers: {} }, { writeHead(s, h) { out.status = s; out.headers = h || {} }, end(c) { if (c) out.body += c } })
  return out
}

console.log('\n[面板]')
const p = call('/dsh-sync/panel')
ok(p.status === 200, '返回 200')
ok(String(p.headers['content-type']).includes('text/html'), 'content-type 是 HTML')
ok(p.body.includes('大肥鱼 · 同步面板'), '标题对')
ok(p.body.includes('立即推送'), '有推送按钮')
ok(p.body.includes('/dsh-sync/status'), '页面会去读状态接口')
ok(p.body.includes('<table'), '有目录表格')
ok(!p.body.includes('undefined'), '没有明显的 undefined 拼接')

console.log('\n[状态接口仍在]')
const s = call('/dsh-sync/status')
ok(s.status === 200, 'status 返回 200')
const j = JSON.parse(s.body)
ok(j.ok === true && j.fatal === false, 'status ok 且 fatal:false')

rmSync(ROOT, { recursive: true, force: true })
console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)
