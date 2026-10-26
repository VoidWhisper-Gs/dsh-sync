/**
 * 客户端 bundle 测试：确认它注册的是 settings.section（跟「鱼的记忆」同一套）。
 * 不渲染 React —— 只验证注册契约。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
const ok = (c, l) => { c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l)) }

let loaded = null
const fakeReact = {
  createElement: (...args) => ({ type: args[0], props: args[1] || {} }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useCallback: (f) => f,
  useMemo: (f) => f(),
}
const sandbox = {
  console,
  fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
  setInterval: () => 0,
  clearInterval: () => {},
  window: { __ModuleLoader__: { load(e) { loaded = e } } },
}
vm.runInNewContext(readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8'), sandbox, { filename: 'client.js' })

console.log('\n[client] bundle')
ok(!!loaded, '调用了 __ModuleLoader__.load')
ok(loaded.id === 'dsh-sync', '注册 id 与包名一致')
ok(typeof loaded.factory === 'function', 'factory 是函数')

const ex = loaded.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error('unexpected require: ' + name)
})
ok(!!ex, 'factory 返回 exports')
ok(typeof ex.apply === 'function', '导出 apply')
ok(Array.isArray(ex.inject) && ex.inject.includes('slots'), 'inject 声明 slots')

console.log('\n[槽位注册]')
let reg = null
const slots = {
  inject: (name, fn) => { ok(name === 'settings.section', 'inject 的目标是 settings.section'); fn() },
  register: (opts, comp) => { reg = { opts, comp } },
}
let threw = false
try { ex.apply({ slots }) } catch (e) { threw = true; console.log('    抛错：' + e.message) }
ok(!threw, 'apply 不抛异常')
ok(!!reg, '调用了 slots.register')
ok(reg.opts.name === 'settings.section', 'name 正确')
ok(reg.opts.id === 'dsh-sync', 'id 正确')
ok(typeof reg.opts.label === 'function' && reg.opts.label() === '数据同步', '侧栏标题是「数据同步」')
ok(typeof reg.opts.order === 'number', 'order 是数字（决定排在哪）')
ok(typeof reg.comp === 'function', '第二个参数是组件')

console.log('\n[缺服务时]')
let threw2 = false
try { ex.apply({}) } catch (e) { threw2 = true }
ok(!threw2, '没有 slots 服务时也不崩（安全退出）')

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)
