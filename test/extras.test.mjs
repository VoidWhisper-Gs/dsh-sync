/**
 * 附加目录（extraDirs）测试：角色卡这类“DSH 之外”的文件夹也能同步。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-sync-extra-'))
const HOME = join(ROOT, 'home')
const CLOUD = join(ROOT, 'cloud')
const EXTRA = join(ROOT, 'workspace', '大肥鱼-角色卡')

let pass = 0, fail = 0
const ok = (c, l) => { c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l)) }

mkdirSync(join(HOME, 'sessions'), { recursive: true })
mkdirSync(EXTRA, { recursive: true })
writeFileSync(join(EXTRA, 'card.json'), '{"name":"大肥鱼"}')
writeFileSync(join(HOME, 'sessions', 'a.txt'), 'a')
writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ cloudDir: CLOUD, auto: false, idleMs: 0, extraDirs: [EXTRA] }))

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

async function post(body) {
  const s = JSON.stringify(body)
  let out = ''
  await routes.get('/dsh-sync/config')({ method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from(s) } }, { writeHead() {}, end(c) { if (c) out += c } })
  return JSON.parse(out)
}

console.log('\n[状态里能看到附加目录]')
const st = call('/dsh-sync/status')
const row = (st.dirs || []).find((d) => d.kind === 'extra')
ok(!!row, 'dirs 里有 kind=extra 的行')
ok(row && row.name === 'extra:' + basename(EXTRA), '名字带 extra: 前缀')
ok(row && row.pendingFiles === 1, '附加目录待同步 1 个文件')

console.log('\n[推送]')
const r = call('/dsh-sync/push')
ok(r.ok === true, 'push 成功')
ok(r.copied >= 2, '至少复制 2 个（会话 + 角色卡）')
const cloudExtra = join(CLOUD, '_extra', basename(EXTRA), 'card.json')
ok(existsSync(cloudExtra), '角色卡被复制到 <网盘>/_extra/<文件夹名>/')
ok(readFileSync(cloudExtra, 'utf8').includes('大肥鱼'), '内容正确')

console.log('\n[配置校验]')
const c = await post({ extraDirs: [EXTRA + '/', '  ', EXTRA] })
ok(c.ok === true, '保存成功')
ok(c.saved.extraDirs.length === 1, '重复/空行被去掉')
ok(c.saved.extraDirs[0] === EXTRA.replace(/\\/g, '/'), '路径被统一成斜杠')

rmSync(ROOT, { recursive: true, force: true })
console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)
