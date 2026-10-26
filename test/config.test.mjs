/**
 * 配置接口测试：POST /dsh-sync/config 改云盘路径 / 自动推送等。
 * 全程临时目录。
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-sync-cfg-'))
const HOME = join(ROOT, 'home')
let pass = 0, fail = 0
const ok = (c, l) => { c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l)) }

mkdirSync(HOME, { recursive: true })
writeFileSync(join(HOME, 'dsh-sync.json'), JSON.stringify({ cloudDir: 'D:/old', auto: true, idleMs: 8000 }))
process.env.DSH_HOME = HOME

const host = (await import('../lib/index.js')).default
const routes = new Map()
host.apply({
  effect(fn) { fn(); return () => {} },
  webServer: { register(r) { routes.set(r.path, r.handler); return () => {} } },
  agents: { list: () => [] },
})

function fakeReq(method, body) {
  const s = body == null ? '' : JSON.stringify(body)
  const req = {
    method,
    headers: {},
    async *[Symbol.asyncIterator]() { if (s) yield Buffer.from(s) },
  }
  return req
}

async function call(p, req) {
  const out = { status: 0, body: '' }
  await routes.get(p)(req || { method: 'GET', headers: {}, async *[Symbol.asyncIterator]() {} }, {
    writeHead(s) { out.status = s },
    end(c) { if (c) out.body += c },
  })
  return out.body ? JSON.parse(out.body) : null
}

console.log('\n[读取]')
const g = await call('/dsh-sync/config', fakeReq('GET'))
ok(g && g.ok === true, 'GET 返回 ok')
ok(g.config.cloudDir === 'D:/old', '返回当前配置')

console.log('\n[保存云盘路径]')
const s1 = await call('/dsh-sync/config', fakeReq('POST', { cloudDir: 'C:\\Users\\me\\BaiduSyncdisk\\DSH_DFY' }))
ok(s1.ok === true, 'POST 成功')
ok(s1.saved.cloudDir === 'C:/Users/me/BaiduSyncdisk/DSH_DFY', '反斜杠被统一成正斜杠')
const f1 = JSON.parse(readFileSync(join(HOME, 'dsh-sync.json'), 'utf8'))
ok(f1.cloudDir === 'C:/Users/me/BaiduSyncdisk/DSH_DFY', '文件里也写对了')

console.log('\n[自动推送开关]')
const s2 = await call('/dsh-sync/config', fakeReq('POST', { auto: false }))
ok(s2.ok === true && s2.saved.auto === false, 'auto 改成了 false')
const s3 = await call('/dsh-sync/config', fakeReq('POST', { auto: true }))
ok(s3.saved.auto === true, 'auto 又能改回 true')

console.log('\n[不认识的字段]')
const s4 = await call('/dsh-sync/config', fakeReq('POST', { 恶意: 'x', dirs: ['/etc'], cloudDir: 'D:/ok' }))
ok(s4.ok === true, '带陌生字段也能保存')
const f2 = JSON.parse(readFileSync(join(HOME, 'dsh-sync.json'), 'utf8'))
ok(Array.isArray(f2.dirs) && f2.dirs.length === 4, 'dirs 被固定成四个标准目录（没被恶意覆盖）')

console.log('\n[空路径]')
const s5 = await call('/dsh-sync/config', fakeReq('POST', { cloudDir: '   ' }))
ok(s5.ok === true && s5.saved.cloudDir === 'D:/ok', '空路径被忽略，保留原值')

console.log('\n[坏 body]')
const bad = await call('/dsh-sync/config', { method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from('not json') } })
ok(bad && bad.ok === true, '坏 JSON 不崩，按空对象处理')

rmSync(ROOT, { recursive: true, force: true })
console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)
