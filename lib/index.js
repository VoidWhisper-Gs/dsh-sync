/**
 * dsh-sync — host half
 * ----------------------------------------------------------------------------
 * 把 DSH 里「会记事的四个目录」同步到一个外部目录（比如百度网盘同步空间）。
 *
 * 核心思路：**插件知道什么时候写完**。
 *   一轮对话结束（agent/turn-stopping）→ 等 debounceMs → 文件安静了才搬。
 *   这样不会去抢正在写的文件，也不会再出现 EBUSY。
 *
 * 三条安全底线（被真实事故教出来的）：
 *   1. 推送前先判断 safeToPush（文件最后修改距今 >= idleMs），不安全就不动
 *   2. 拉取默认关闭（allowPull），开了也要先备份，且只在没有活动时做
 *   3. 所有操作都有 summary 返回：搬了几个、多少字节、跳过什么
 */
import { existsSync, readFileSync, readdirSync, statSync, copyFileSync, mkdirSync, writeFileSync, utimesSync, lstatSync } from 'node:fs'
import { join, relative, sep, dirname } from 'node:path'
import { homedir } from 'node:os'

const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CONFIG_FILE = join(HOME, 'dsh-sync.json')
const STATE_FILE = join(HOME, 'dsh-sync-state.json')

const DIRS = ['sessions', 'storages', 'fish-memory', 'feiyu-mood']

const DEFAULTS = {
  cloudDir: '',             // 空 = 还没配置（去设置页填）
  auto: true,               // 一轮结束后自动推送
  debounceMs: 5000,         // 一轮结束到动手之间等多久
  idleMs: 8000,             // 文件安静这么久才认为"写完了"
  allowPull: false,         // 拉取默认关闭（会覆盖本地）
  dirs: DIRS,
}

/* ── 配置 / 状态 ───────────────────────────────────────────────────────── */

function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function readConfig() {
  const raw = readJson(CONFIG_FILE, {})
  const cfg = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  if (typeof cfg.cloudDir !== 'string' || !cfg.cloudDir.trim()) cfg.cloudDir = DEFAULTS.cloudDir
  cfg.cloudDir = cfg.cloudDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const d = Number(cfg.debounceMs); cfg.debounceMs = Number.isFinite(d) && d >= 0 ? d : DEFAULTS.debounceMs
  const i = Number(cfg.idleMs); cfg.idleMs = Number.isFinite(i) && i >= 0 ? i : DEFAULTS.idleMs
  cfg.auto = cfg.auto === true
  cfg.allowPull = cfg.allowPull === true
  cfg.dirs = Array.isArray(cfg.dirs) && cfg.dirs.length ? cfg.dirs.filter((x) => DIRS.includes(x)) : DIRS
  if (!cfg.dirs.length) cfg.dirs = DIRS
  return cfg
}

function writeState(patch) {
  const old = readJson(STATE_FILE, {})
  const next = { ...old, ...patch, version: 1 }
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 2))
  } catch { /* 写不了就下次再说 */ }
  return next
}

/* ── 文件遍历 / 比较 ───────────────────────────────────────────────────── */

function walk(root) {
  const out = new Map()
  if (!existsSync(root)) return out
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile()) {
        try {
          const st = statSync(full)
          out.set(relative(root, full).split(sep).join('/'), { size: st.size, mtimeMs: st.mtimeMs, full })
        } catch { /* skip */ }
      }
    }
  }
  return out
}

function diffDir(localRoot, cloudRoot) {
  const local = walk(localRoot)
  const cloud = walk(cloudRoot)
  let pendingFiles = 0, pendingBytes = 0, newest = 0, totalBytes = 0
  const pending = []
  for (const [rel, info] of local) {
    totalBytes += info.size
    if (info.mtimeMs > newest) newest = info.mtimeMs
    const c = cloud.get(rel)
    if (!c || c.size !== info.size || info.mtimeMs > c.mtimeMs + 1000) {
      pendingFiles++
      pendingBytes += info.size
      pending.push(rel)
    }
  }
  return { files: local.size, totalBytes, pendingFiles, pendingBytes, newestMtime: newest, cloudFiles: cloud.size, pending, local, cloud }
}

function human(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/**
 * 安全检查（2026-10-26 事故之后加的）：
 *   1. 数据目录**不许是联接**——否则 DSH 其实在往目标目录（比如网盘）写，
 *      同步工具一碰就会 fork 出冲突副本，会话日志就会出现 seq gap。
 *   2. 云盘目录**不许落在数据目录里面**——否则副本会写回数据目录。
 * 只要有一条中，push/pull 一律拒绝，status 直接标红。
 */
function linkCheck(cfg) {
  const issues = []
  for (const name of cfg.dirs) {
    const p = join(HOME, name)
    try {
      if (existsSync(p) && lstatSync(p).isSymbolicLink()) {
        issues.push({
          dir: name,
          path: p.replace(/\\/g, '/'),
          problem: '这是个联接（junction/symlink），指向别处；DSH 实际会写到目标目录去',
        })
      }
    } catch { /* 读不到就算了 */ }
  }
  const homeNorm = HOME.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const cloudNorm = String(cfg.cloudDir || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  if (cloudNorm && (cloudNorm === homeNorm || cloudNorm.startsWith(homeNorm + '/'))) {
    issues.push({
      dir: 'cloudDir',
      path: cfg.cloudDir,
      problem: '云盘目录落在 DSH 数据目录里面，副本会写回数据目录',
    })
  }
  return issues
}

function copyOne(src, dest) {
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  try {
    const st = statSync(src)
    utimesSync(dest, st.atime, st.mtime)
  } catch { /* 时间戳失败不影响内容 */ }
}

/** 汇总：现在安不安全、要不要搬、搬多少 */
function inspect(cfg) {
  const now = Date.now()
  const dirs = []
  let newest = 0, totalFiles = 0, totalBytes = 0, pendingFiles = 0, pendingBytes = 0
  for (const name of cfg.dirs) {
    const localRoot = join(HOME, name)
    const configured = !!cfg.cloudDir
    const cloudRoot = configured ? join(cfg.cloudDir, name) : ''
    const d = configured ? diffDir(localRoot, cloudRoot) : (() => {
      const local = walk(localRoot)
      let total = 0, newestLocal = 0
      for (const [, info] of local) {
        total += info.size
        if (info.mtimeMs > newestLocal) newestLocal = info.mtimeMs
      }
      return { files: local.size, totalBytes: total, pendingFiles: 0, pendingBytes: 0, newestMtime: newestLocal, cloudFiles: 0 }
    })()
    if (d.newestMtime > newest) newest = d.newestMtime
    totalFiles += d.files; totalBytes += d.totalBytes
    pendingFiles += d.pendingFiles; pendingBytes += d.pendingBytes
    dirs.push({ name, local: localRoot.replace(/\\/g, '/'), cloud: cloudRoot ? cloudRoot.replace(/\\/g, '/') : '', localExists: existsSync(localRoot), cloudExists: configured ? existsSync(cloudRoot) : false, files: d.files, bytes: d.totalBytes, bytesHuman: human(d.totalBytes), pendingFiles: d.pendingFiles, pendingBytes: d.pendingBytes, pendingBytesHuman: human(d.pendingBytes) })
  }
  const idleForMs = newest ? now - newest : null
  const safeToPush = idleForMs != null && idleForMs >= cfg.idleMs
  return { dirs, totalFiles, totalBytes, pendingFiles, pendingBytes, newest, idleForMs, safeToPush }
}

/**
 * 自动推送该等多久：取「防抖」和「安静门槛 + 余量」的较大值。
 *
 * ⚠️ v0.2.1 的坑：原来直接用 debounceMs(5s)，但「可以推」的门槛是 idleMs(8s)，
 * 于是每次都在文件还热的时候去推 → 被自己拦下 → 看起来“自动推送从不工作”。
 */
export function __autoDelayMs(debounceMs, idleMs) {
  return Math.max(debounceMs, idleMs + 1500)
}

export default {
  name: 'dsh-sync',
  inject: ['webServer', 'agents'],
  apply(ctx) {
    const json = (res, status, data) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
    }

    /* ── 推送：本地 → 网盘 ─────────────────────────────────────────────── */

    function doPush(opts = {}) {
      const cfg = readConfig()
      const issues = linkCheck(cfg)
      if (issues.length) {
        return { ok: false, error: '目录不安全', issues, note: '数据目录是联接 / 或云盘目录在数据目录里 —— 拒绝推送（会毁会话日志）' }
      }
      if (!cfg.cloudDir) {
        return { ok: false, error: '还没设置云盘目录', note: '去 设置 → 数据同步 里填一个目录，比如 D:/BaiduSyncdisk/DSH_DFY' }
      }
      const info = inspect(cfg)
      if (!opts.force && !info.safeToPush) {
        return {
          ok: false,
          error: '还没写完',
          reason: info.idleForMs == null ? '没有可同步的文件' : `文件 ${Math.round(info.idleForMs / 1000)} 秒前还在写，低于 idleMs=${cfg.idleMs}ms`,
          idleForMs: info.idleForMs,
        }
      }
      let copied = 0, bytes = 0
      const failures = []
      for (const name of cfg.dirs) {
        const localRoot = join(HOME, name)
        const cloudRoot = join(cfg.cloudDir, name)
        const d = diffDir(localRoot, cloudRoot)
        for (const rel of d.pending) {
          const src = d.local.get(rel).full
          const dest = join(cloudRoot, rel.split('/').join(sep))
          try {
            copyOne(src, dest)
            copied++
            bytes += d.local.get(rel).size
          } catch (e) {
            failures.push({ file: rel, error: String(e && e.message) })
          }
        }
      }
      const state = writeState({ lastPushAt: new Date().toISOString(), lastPush: { copied, bytes, failures: failures.length } })
      return { ok: failures.length === 0, copied, bytes, bytesHuman: human(bytes), failures, state: { lastPushAt: state.lastPushAt } }
    }

    /* ── 拉取：网盘 → 本地（默认关闭）─────────────────────────────────── */

    function doPull(opts = {}) {
      const cfg = readConfig()
      const issues = linkCheck(cfg)
      if (issues.length) {
        return { ok: false, error: '目录不安全', issues, note: '数据目录是联接 / 或云盘目录在数据目录里 —— 拒绝拉取' }
      }
      if (!cfg.cloudDir) {
        return { ok: false, error: '还没设置云盘目录', note: '去 设置 → 数据同步 里填一个目录' }
      }
      if (!cfg.allowPull && !opts.force) {
        return { ok: false, error: '拉取未启用', note: '拉取会覆盖本地文件。确认要在 dsh-sync.json 里设 "allowPull": true' }
      }
      const info = inspect(cfg)
      if (!opts.force && !info.safeToPush) {
        return { ok: false, error: '还没安静下来', reason: '文件刚被写过，拉取可能被覆盖回去' }
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupRoot = join(HOME, '_backup-before-pull', stamp)
      let copied = 0, bytes = 0
      const failures = []
      // 先备份本地
      for (const name of cfg.dirs) {
        const localRoot = join(HOME, name)
        if (!existsSync(localRoot)) continue
        try {
          for (const [rel, info2] of walk(localRoot)) {
            copyOne(info2.full, join(backupRoot, name, rel.split('/').join(sep)))
          }
        } catch (e) {
          failures.push({ phase: 'backup', dir: name, error: String(e && e.message) })
        }
      }
      // 再复制回来：只复制网盘里更新的
      for (const name of cfg.dirs) {
        const localRoot = join(HOME, name)
        const cloudRoot = join(cfg.cloudDir, name)
        const cl = walk(cloudRoot)
        const lc = walk(localRoot)
        for (const [rel, cinfo] of cl) {
          const linfo = lc.get(rel)
          if (linfo && linfo.size === cinfo.size && linfo.mtimeMs >= cinfo.mtimeMs - 1000) continue
          try {
            copyOne(cinfo.full, join(localRoot, rel.split('/').join(sep)))
            copied++
            bytes += cinfo.size
          } catch (e) {
            failures.push({ phase: 'pull', file: rel, error: String(e && e.message) })
          }
        }
      }
      const state = writeState({ lastPullAt: new Date().toISOString(), lastPull: { copied, bytes, failures: failures.length, backup: backupRoot.replace(/\\/g, '/') } })
      return { ok: failures.length === 0, copied, bytes, bytesHuman: human(bytes), backup: backupRoot.replace(/\\/g, '/'), failures, state: { lastPullAt: state.lastPullAt } }
    }

    /* ── 路由 ─────────────────────────────────────────────────────────── */

    const statusHandler = (_req, res) => {
      try {
        const cfg = readConfig()
        const info = inspect(cfg)
        const state = readJson(STATE_FILE, {})
        const issues = linkCheck(cfg)
        json(res, 200, {
          ok: true,
          mode: 'readwrite',
          fatal: issues.length > 0,
          issues,
          configured: !!cfg.cloudDir,
          config: cfg,
          cloudDirExists: cfg.cloudDir ? existsSync(cfg.cloudDir) : false,
          dirs: info.dirs,
          total: { files: info.totalFiles, bytes: info.totalBytes, bytesHuman: human(info.totalBytes), pendingFiles: info.pendingFiles, pendingBytes: info.pendingBytes, pendingBytesHuman: human(info.pendingBytes) },
          lastActivityAt: info.newest || null,
          idleForMs: info.idleForMs,
          idleForHuman: info.idleForMs == null ? null : Math.round(info.idleForMs / 1000) + ' 秒',
          safeToPush: info.safeToPush,
          safeReason: info.safeToPush
            ? '文件已经安静 ' + Math.round(info.idleForMs / 1000) + ' 秒，可以安全搬运'
            : (info.idleForMs == null ? '没有可同步的文件' : '文件刚被写过（' + Math.round(info.idleForMs / 1000) + ' 秒前），再等等'),
          lastPushAt: state.lastPushAt || null,
          lastPullAt: state.lastPullAt || null,
        })
      } catch (e) {
        json(res, 200, { ok: false, error: String(e && e.message) })
      }
    }

    const pushHandler = (_req, res) => {
      try { json(res, 200, doPush()) } catch (e) { json(res, 200, { ok: false, error: String(e && e.message) }) }
    }

    const pullHandler = (_req, res) => {
      try { json(res, 200, doPull()) } catch (e) { json(res, 200, { ok: false, error: String(e && e.message) }) }
    }

    /* ── 面板页：浏览器打开 /dsh-sync/panel ───────────────────────────── */

    function panelHtml() {
      const css = [
        '*{box-sizing:border-box}',
        'body{margin:0;padding:28px;background:#0f1115;color:#e9ecf3;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}',
        'h1{font-size:18px;margin:0 0 4px}',
        '.sub{color:#8b93a3;font-size:12px;margin-bottom:18px}',
        '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}',
        '.card{background:#171a21;border:1px solid #262b36;border-radius:12px;padding:14px}',
        '.k{color:#8b93a3;font-size:12px;margin-bottom:6px}',
        '.v{font-size:22px;font-weight:600}',
        '.v.small{font-size:15px}',
        '.ok{color:#4ade80}.bad{color:#f87171}.warn{color:#fbbf24}',
        'button{background:#232936;color:#e9ecf3;border:1px solid #333b4a;border-radius:8px;padding:8px 14px;cursor:pointer;font:inherit;margin-right:8px}',
        'button:hover{background:#2c3342}',
        'button:disabled{opacity:.45;cursor:not-allowed}',
        'table{width:100%;border-collapse:collapse;margin-top:6px}',
        'th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #222733;font-size:13px}',
        'th{color:#8b93a3;font-weight:500;font-size:12px}',
        '#banner{display:none;background:#3b1d1d;border:1px solid #7f1d1d;color:#fca5a5;padding:10px 14px;border-radius:10px;margin-bottom:16px}',
        '#msg{margin-top:14px;color:#8b93a3;font-size:12px;min-height:18px;white-space:pre-wrap}',
      ].join('\n')

      const js = [
        "function el(id){return document.getElementById(id)}",
        "function fmt(n){return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB'}",
        "function render(j){",
        "  try{",
        "    if(!j||!j.ok){el('msg').textContent='状态读取失败：'+((j&&j.error)||'未知');return}",
        "    el('fatal').style.display=j.fatal?'block':'none'",
        "    if(j.fatal){el('fatal').textContent='⚠ 危险配置：'+ (j.issues||[]).map(function(i){return i.dir+' - '+i.problem}).join('；')}",
        "    el('pending').textContent=j.total.pendingFiles+' 个'",
        "    el('pendingsize').textContent=j.total.pendingBytesHuman",
        "    el('total').textContent=j.total.files+' 个'",
        "    el('totalsize').textContent=j.total.bytesHuman",
        "    var s=el('safe');s.textContent=j.safeToPush?'可以推送':'先等等';s.className='v small '+(j.safeToPush?'ok':'warn')",
        "    el('why').textContent=j.safeReason||''",
        "    el('lastpush').textContent=j.lastPushAt?new Date(j.lastPushAt).toLocaleString():'还没推过'",
        "    var rows=''",
        "    for(var i=0;i<j.dirs.length;i++){var d=j.dirs[i];",
        "      rows+='<tr><td>'+d.name+'</td><td>'+d.files+'</td><td>'+d.bytesHuman+'</td><td>'+d.pendingFiles+'</td><td>'+(d.pendingBytesHuman||'0 B')+'</td></tr>'}",
        "    el('rows').innerHTML=rows",
        "    el('ts').textContent='刷新于 '+new Date().toLocaleTimeString()",
        "  }catch(e){el('msg').textContent='渲染出错：'+e.message}",
        "}",
        "function refresh(){fetch('/dsh-sync/status',{cache:'no-store'}).then(function(r){return r.json()}).then(render).catch(function(e){el('msg').textContent='连不上宿主：'+e.message})}",
        "function act(path,label){",
        "  el('msg').textContent=label+'中…'",
        "  fetch(path,{cache:'no-store'}).then(function(r){return r.json()}).then(function(j){",
        "    if(j.ok){el('msg').textContent=label+'完成：复制 '+j.copied+' 个 / '+fmt(j.bytes||0)}",
        "    else{el('msg').textContent=label+'被拒绝：'+(j.error||'')+' '+(j.reason||'')}",
        "    refresh()",
        "  }).catch(function(e){el('msg').textContent=label+'失败：'+e.message})",
        "}",
        "el('btnRefresh').onclick=refresh",
        "el('btnPush').onclick=function(){act('/dsh-sync/push','推送')}",
        "el('btnPull').onclick=function(){act('/dsh-sync/pull','拉取')}",
        "refresh();setInterval(refresh,3000)",
      ].join('\n')

      return [
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
        '<title>大肥鱼 · 同步面板</title><style>' + css + '</style></head><body>',
        '<h1>大肥鱼 · 同步面板</h1>',
        '<div class="sub">本地 → 网盘副本。DSH 永远不直接写这个副本目录。<span id="ts"></span></div>',
        '<div id="fatal" class="card" style="display:none;margin-bottom:16px;border-color:#7f1d1d"></div>',
        '<div class="grid">',
        '  <div class="card"><div class="k">待同步</div><div class="v" id="pending">—</div><div class="k" id="pendingsize">—</div></div>',
        '  <div class="card"><div class="k">总文件</div><div class="v" id="total">—</div><div class="k" id="totalsize">—</div></div>',
        '  <div class="card"><div class="k">现在能推吗</div><div class="v small" id="safe">—</div><div class="k" id="why">—</div></div>',
        '  <div class="card"><div class="k">上次推送</div><div class="v small" id="lastpush">—</div></div>',
        '</div>',
        '<div><button id="btnRefresh">刷新</button><button id="btnPush">立即推送</button><button id="btnPull" title="会覆盖本地，默认关闭">从网盘拉取</button></div>',
        '<table><thead><tr><th>目录</th><th>文件</th><th>大小</th><th>待同步</th><th>待同步大小</th></tr></thead><tbody id="rows"></tbody></table>',
        '<div id="msg"></div>',
        '<script>' + js + '</script>',
        '</body></html>',
      ].join('\n')
    }

    const panelHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(panelHtml())
    }

    /* ── 配置读写：面板里改云盘路径 / 自动推送 ─────────────────────────── */

    async function readBody(req) {
      try {
        let body = ''
        for await (const chunk of req) body += chunk
        return JSON.parse(body || '{}')
      } catch {
        return {}
      }
    }

    const configHandler = async (req, res) => {
      try {
        if (req.method !== 'POST') {
          return json(res, 200, { ok: true, config: readConfig() })
        }
        const body = await readBody(req)
        const cur = readConfig()
        const next = { ...cur }
        if (typeof body.cloudDir === 'string' && body.cloudDir.trim()) next.cloudDir = body.cloudDir.trim()
        if (typeof body.auto === 'boolean') next.auto = body.auto
        if (typeof body.allowPull === 'boolean') next.allowPull = body.allowPull
        if (body.debounceMs != null) next.debounceMs = Number(body.debounceMs)
        if (body.idleMs != null) next.idleMs = Number(body.idleMs)

        // 只写已知字段，顺手把反斜杠统一成斜杠（Windows 路径两种写法都能用）
        const clampMs = (v, fallback) => {
          const n = Number(v)
          if (!Number.isFinite(n)) return fallback
          return Math.min(600000, Math.max(0, Math.round(n)))
        }
        const saved = {
          cloudDir: String(next.cloudDir).replace(/\\/g, '/').replace(/\/+$/, ''),
          auto: next.auto === true,
          debounceMs: clampMs(next.debounceMs, DEFAULTS.debounceMs),
          idleMs: clampMs(next.idleMs, DEFAULTS.idleMs),
          allowPull: next.allowPull === true,
          dirs: DIRS,
        }

        mkdirSync(dirname(CONFIG_FILE), { recursive: true })
        writeFileSync(CONFIG_FILE, JSON.stringify(saved, null, 2) + '\n')
        writeState({ lastConfigAt: new Date().toISOString() })
        json(res, 200, { ok: true, config: readConfig(), saved })
      } catch (e) {
        json(res, 200, { ok: false, error: String(e && e.message) })
      }
    }


    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/dsh-sync/status', handler: statusHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/dsh-sync/push', handler: pushHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/dsh-sync/pull', handler: pullHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/dsh-sync/panel', handler: panelHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/dsh-sync/config', handler: configHandler }))

    /* ── 自动推送：一轮结束后，防抖，再搬 ─────────────────────────────── */

    let timer = null

    function schedule(reason) {
      const cfg = readConfig()
      if (!cfg.auto) return
      if (timer) clearTimeout(timer)

      const attempt = (left) => {
        let r = null
        try {
          r = doPush()
        } catch (e) {
          writeState({ lastAutoPushAt: new Date().toISOString(), lastAutoResult: { ok: false, error: String(e && e.message), reason } })
          return
        }
        writeState({ lastAutoPushAt: new Date().toISOString(), lastAutoResult: { ok: r.ok, copied: r.copied || 0, error: r.error || null, reason } })
        // 还在写 → 过 3 秒再试（最多 3 次），别让这一轮白白过去
        if (!r.ok && r.error === '还没写完' && left > 0) {
          timer = setTimeout(() => attempt(left - 1), 3000)
          try { if (timer.unref) timer.unref() } catch { /* ignore */ }
        }
      }

      timer = setTimeout(() => {
        timer = null
        attempt(3)
      }, __autoDelayMs(cfg.debounceMs, cfg.idleMs))
      try { if (timer.unref) timer.unref() } catch { /* ignore */ }
    }

    // 每 5 秒扫一遍 agents，给新出现的挂 turn-stopping（只挂一次）
    const hooked = new WeakSet()
    const scan = () => {
      try {
        const list = ctx.agents.list() || []
        for (const agent of list) {
          if (!agent || hooked.has(agent)) continue
          hooked.add(agent)
          try {
            agent.ctx.on('agent/turn-stopping', () => schedule('turn-stopping'))
          } catch { /* 挂不上就算了 */ }
        }
      } catch { /* agents 服务还没好 */ }
    }
    ctx.effect(() => {
      const h = setInterval(scan, 5000)
      try { if (h.unref) h.unref() } catch { /* ignore */ }
      scan()
      return () => clearInterval(h)
    })

    // 启动时先落一份状态，方便排查
    try {
      const cfg = readConfig()
      writeState({ startedAt: new Date().toISOString(), cloudDir: cfg.cloudDir, auto: cfg.auto })
    } catch { /* ignore */ }
  },
}
