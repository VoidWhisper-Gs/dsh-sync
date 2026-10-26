/**
 * 自动推送等待时长的回归测试（v0.2.2 修的 bug）
 * ----------------------------------------------------------------------------
 * 原来直接用 debounceMs(5s)，但「可以推」要 idleMs(8s)，
 * 结果每次都在文件还热的时候去推 —— 自动推送看起来永远不工作。
 */
import { __autoDelayMs } from '../lib/index.js'

let pass = 0, fail = 0
const ok = (c, l) => { c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l)) }

console.log('\n[等待时长]')
ok(__autoDelayMs(5000, 8000) === 9500, 'debounce 5s + idle 8s → 等 9.5s（不是 5s）')
ok(__autoDelayMs(5000, 8000) > 8000, '必须比 idleMs 大，否则一定被自己拦住')
ok(__autoDelayMs(20000, 8000) === 20000, 'debounce 更大时听 debounce')
ok(__autoDelayMs(0, 0) === 1500, '都为 0 时也有 1.5s 余量')

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)
