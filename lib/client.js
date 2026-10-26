// DSH「数据同步」· 网页半边
//
// 在 DSH 设置页左侧栏加一项「数据同步」：
//   · 云盘目录输入框（两台机器盘符可能不一样，各填各的）
//   · 自动推送开关
//   · 待同步 / 能不能推 / 上次推送
//   · 两个按钮（立即推送 / 从网盘拉取）
//
// ⚠ 这里不碰文件，只读写宿主那几条 /dsh-sync/* 路由。
//   槽位名 'settings.section' 跟 dsh-speak-up / dsh-fish-memory 用的是同一个。

window.__ModuleLoader__.load({
  id: 'dsh-sync',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']
    const h = React.createElement

    const S = {
      wrap: {
        padding: '12px 14px 24px',
        fontSize: 13,
        lineHeight: 1.7,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
        borderRadius: 12,
      },
      h: { fontSize: 14, fontWeight: 600, margin: '16px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12 },
      input: {
        flex: '1 1 320px',
        minWidth: 240,
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '5px 9px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
      },
      textarea: {
        width: '100%',
        minHeight: 64,
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '6px 9px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        fontFamily: 'inherit',
        resize: 'vertical',
      },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 },
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: '8px 10px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      k: { opacity: 0.6, fontSize: 11.5, marginBottom: 2 },
      v: { fontSize: 18, fontWeight: 600 },
      vs: { fontSize: 13, fontWeight: 600 },
      ok: { color: 'var(--dsw-alias-state-success-primary, #22c55e)' },
      warn: { color: 'var(--dsw-alias-state-warning-primary, #f59e0b)' },
      btn: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '5px 12px',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12.5,
        marginRight: 8,
      },
      banner: {
        border: '1px solid var(--dsw-alias-state-error-primary, #ef4444)',
        borderRadius: 8,
        padding: '8px 10px',
        marginBottom: 12,
        fontSize: 12.5,
      },
      table: { width: '100%', borderCollapse: 'collapse', marginTop: 6 },
      th: { textAlign: 'left', padding: '6px 4px', fontSize: 11.5, opacity: 0.6, fontWeight: 500, borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      td: { padding: '6px 4px', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: 12.5 },
      msg: { marginTop: 10, fontSize: 12, opacity: 0.7, minHeight: 18 },
    }

    function fmt(n) {
      if (typeof n !== 'number') return '—'
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1048576).toFixed(1) + ' MB'
    }

    function Section() {
      const [st, setSt] = React.useState(null)
      const [msg, setMsg] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [dir, setDir] = React.useState('')
      const [auto, setAuto] = React.useState(true)
      const [allowPull, setAllowPull] = React.useState(false)
      const [debounceS, setDebounceS] = React.useState(5)
      const [idleS, setIdleS] = React.useState(8)
      const [extraText, setExtraText] = React.useState('')
      const inited = React.useRef(false)
      const savedSnap = React.useRef('')

      const normExtra = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean).join('\n')

      const load = React.useCallback(() => {
        fetch('/dsh-sync/status', { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => {
            setSt(j)
            // 只在第一次用配置初始化输入框，别把用户正在打的字覆盖掉
            if (!inited.current && j && j.config) {
              const d0 = j.config.cloudDir || ''
              const a0 = j.config.auto !== false
              const p0 = j.config.allowPull === true
              const db0 = Math.round((Number(j.config.debounceMs) || 5000) / 100) / 10
              const id0 = Math.round((Number(j.config.idleMs) || 8000) / 100) / 10
              const ex0 = (Array.isArray(j.config.extraDirs) ? j.config.extraDirs : []).join('\n')
              setDir(d0); setAuto(a0); setAllowPull(p0); setDebounceS(db0); setIdleS(id0); setExtraText(ex0)
              savedSnap.current = JSON.stringify({ dir: d0, auto: a0, allowPull: p0, debounceS: db0, idleS: id0, extraText: normExtra(ex0) })
              inited.current = true
            }
          })
          .catch((e) => setMsg('连不上宿主：' + (e && e.message)))
      }, [])

      React.useEffect(() => {
        load()
        const t = setInterval(load, 3000)
        return () => clearInterval(t)
      }, [load])

      function save() {
        setBusy(true)
        setMsg('保存中…')
        const payload = {
          cloudDir: dir,
          auto,
          allowPull,
          debounceMs: Math.round((Number(debounceS) || 0) * 1000),
          idleMs: Math.round((Number(idleS) || 0) * 1000),
          extraDirs: normExtra(extraText).split('\n').filter(Boolean),
        }
        fetch('/dsh-sync/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) {
              const s = j.saved || {}
              // 把「实际存下来的」回填到输入框，别让界面和文件说两套话
              const backDebounce = Math.round((Number(s.debounceMs) || 0) / 100) / 10
              const backIdle = Math.round((Number(s.idleMs) || 0) / 100) / 10
              setDebounceS(backDebounce)
              setIdleS(backIdle)
              setDir(s.cloudDir || dir)
              setAuto(s.auto === true)
              setAllowPull(s.allowPull === true)
              savedSnap.current = JSON.stringify({
                dir: s.cloudDir || '',
                auto: s.auto === true,
                allowPull: s.allowPull === true,
                debounceS: backDebounce,
                idleS: backIdle,
                extraText: normExtra((Array.isArray(s.extraDirs) ? s.extraDirs : []).join('\n')),
              })
              setMsg('已保存：防抖 ' + backDebounce + ' 秒 / 安静门槛 ' + backIdle + ' 秒 · ' + (s.cloudDir || ''))
            } else {
              setMsg('保存失败：' + ((j && j.error) || '未知'))
            }
            inited.current = true
            load()
          })
          .catch((e) => setMsg('保存失败：' + (e && e.message)))
          .then(() => setBusy(false))
      }

      function act(path, label) {
        setBusy(true)
        setMsg(label + '中…')
        fetch(path, { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) setMsg(label + '完成：复制 ' + (j.copied || 0) + ' 个文件')
            else setMsg(label + '被拒绝：' + ((j && j.error) || '') + ' ' + ((j && (j.reason || j.note)) || ''))
            load()
          })
          .catch((e) => setMsg(label + '失败：' + (e && e.message)))
          .then(() => setBusy(false))
      }

      const j = st
      const total = (j && j.total) || {}
      const dirs = (j && j.dirs) || []
      const fatal = !!(j && j.fatal)
      const dirty = !!savedSnap.current && savedSnap.current !== JSON.stringify({ dir, auto, allowPull, debounceS, idleS, extraText: normExtra(extraText) })

      const cards = h('div', { style: S.grid },
        h('div', { style: S.card }, h('div', { style: S.k }, '待同步'), h('div', { style: S.v }, String(total.pendingFiles == null ? '—' : total.pendingFiles)), h('div', { style: S.k }, fmt(total.pendingBytes))),
        h('div', { style: S.card }, h('div', { style: S.k }, '总文件'), h('div', { style: S.v }, String(total.files == null ? '—' : total.files)), h('div', { style: S.k }, fmt(total.bytes))),
        h('div', { style: S.card }, h('div', { style: S.k }, '现在能推吗'), h('div', { style: Object.assign({}, S.vs, j && j.safeToPush ? S.ok : S.warn) }, j ? (j.safeToPush ? '可以推送' : '先等等') : '—'), h('div', { style: S.k }, (j && j.safeReason) || '')),
        h('div', { style: S.card }, h('div', { style: S.k }, '上次推送'), h('div', { style: S.vs }, j && j.lastPushAt ? new Date(j.lastPushAt).toLocaleString() : '还没推过'), h('div', { style: S.k }, '')),
      )

      const rows = dirs.map((d) => h('tr', { key: d.name },
        h('td', { style: S.td }, d.name),
        h('td', { style: S.td }, String(d.files)),
        h('td', { style: S.td }, d.bytesHuman),
        h('td', { style: S.td }, String(d.pendingFiles)),
        h('td', { style: S.td }, d.pendingBytesHuman || '0 B'),
      ))

      return h('div', { style: S.wrap },
        h('div', { style: S.h }, '数据同步'),
        h('div', { style: S.dim }, '本地 → 网盘副本。DSH 只写本地，副本由插件在文件安静后推送。'),

        fatal ? h('div', { style: S.banner },
          '⚠ 危险配置：' + (j.issues || []).map((i) => i.dir + ' — ' + i.problem).join('；'),
          h('div', { style: S.dim }, '这种配置下推送/拉取都会被拒绝（防止把会话日志写坏）。'),
        ) : null,

        h('div', { style: S.h }, '云盘目录'),
        h('div', { style: S.dim }, '两台机器的盘符可能不一样，各填各的：公司这台、家里那台，分别改成自己电脑上的实际路径。'),
        h('div', { style: { display: 'flex', gap: 8, margin: '8px 0 14px', flexWrap: 'wrap' } },
          h('input', {
            style: S.input,
            value: dir,
            placeholder: 'D:/BaiduSyncdisk/DSH_DFY',
            onChange: (e) => setDir(e.target.value),
          }),
        ),

        h('div', { style: S.h }, '附加目录'),
        h('div', { style: S.dim }, '想跟着一起同步的其它文件夹，每行一个绝对路径（最多 8 个）。比如角色卡所在的工作区：'),
        h('textarea', {
          style: S.textarea,
          rows: 3,
          value: extraText,
          placeholder: 'C:/Users/Admin/DSH_DFY/大肥鱼-角色卡',
          onChange: (e) => setExtraText(e.target.value),
        }),
        h('div', { style: Object.assign({}, S.dim, { marginBottom: 4 }) },
          '会同步到 <网盘目录>/_extra/<文件夹名>/；不填就只同步上面那四个 DSH 目录。'),

        h('div', { style: S.h }, '同步节奏'),
        h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 6px' } },
          h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 } },
            '防抖',
            h('input', {
              style: Object.assign({}, S.input, { flex: '0 0 84px', minWidth: 84 }),
              type: 'number', min: 0, step: 0.5,
              value: debounceS,
              onChange: (e) => setDebounceS(Number(e.target.value)),
            }),
            '秒',
          ),
          h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 } },
            '安静门槛',
            h('input', {
              style: Object.assign({}, S.input, { flex: '0 0 84px', minWidth: 84 }),
              type: 'number', min: 0, step: 0.5,
              value: idleS,
              onChange: (e) => setIdleS(Number(e.target.value)),
            }),
            '秒',
          ),
        ),
        h('div', { style: Object.assign({}, S.dim, { marginBottom: 4 }) },
          '实际等待 ≈ ' + (Math.max(debounceS || 0, (idleS || 0) + 1.5)).toFixed(1) + ' 秒'
            + '（取两者较大值 + 1.5 秒余量）；被拦下会 3 秒后重试，最多 3 次。',
        ),

        h('div', { style: S.h }, '开关'),
        h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, marginBottom: 4 } },
          h('input', { type: 'checkbox', checked: auto, onChange: (e) => setAuto(e.target.checked) }),
          '一轮对话结束后自动推送',
        ),
        h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, marginBottom: 4 } },
          h('input', { type: 'checkbox', checked: allowPull, onChange: (e) => setAllowPull(e.target.checked) }),
          '允许「从网盘拉取」（会覆盖本地）',
        ),
        h('div', { style: Object.assign({}, S.dim, { marginBottom: 4 }) },
          '拉取是覆盖方向，只建议在「刚装上 / 刚启动、还没开始聊」的时候打开用一次，用完再关掉。',
        ),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 4px', flexWrap: 'wrap' } },
          h('button', {
            style: Object.assign({}, S.btn, { marginRight: 0, padding: '6px 16px' }),
            onClick: save,
            disabled: busy,
          }, '保存全部设置'),
          dirty
            ? h('span', { style: Object.assign({}, S.dim, { color: 'var(--dsw-alias-state-warning-primary, #f59e0b)' }) }, '● 有改动还没保存')
            : null,
        ),
        h('div', { style: Object.assign({}, S.dim, { marginBottom: 4 }) },
          '这一下会把「云盘目录 / 同步节奏 / 开关」一起存。保存成功后上面的数字会在 3 秒内刷新。'),

        cards,
        h('div', {},
          h('button', { style: S.btn, onClick: load, disabled: busy }, '刷新'),
          h('button', { style: S.btn, onClick: () => act('/dsh-sync/push', '推送'), disabled: busy }, '立即推送'),
          h('button', { style: S.btn, onClick: () => act('/dsh-sync/pull', '拉取'), disabled: busy, title: '会覆盖本地，默认关闭' }, '从网盘拉取'),
        ),
        h('table', { style: S.table },
          h('thead', {}, h('tr', {},
            h('th', { style: S.th }, '目录'),
            h('th', { style: S.th }, '文件'),
            h('th', { style: S.th }, '大小'),
            h('th', { style: S.th }, '待同步'),
            h('th', { style: S.th }, '待同步大小'),
          )),
          h('tbody', {}, rows),
        ),
        h('div', { style: S.msg }, msg),
      )
    }

    function apply(ctx) {
      const slots = ctx.slots
      if (!slots) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'dsh-sync', order: 54, label: () => '数据同步' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
