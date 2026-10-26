# dsh-sync

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的**数据同步插件**：把记忆、会话、心情同步到网盘（或任意目录）。

**核心：插件知道什么时候写完。** 一轮对话结束 → 等几秒 → 确认文件安静了才搬。
所以不会去抢正在写的文件，也不会出现 `EBUSY`。

```
C:\Users\<你>\.dsh          ← DSH 只写这里（本地）
        │
        │  一轮结束后，插件安全地复制一份
        ▼
D:\BaiduSyncdisk\...        ← 只有副本，DSH 从不直接写
```

> ⚠️ **铁律**：数据目录**不能**是网盘目录、不能是联接、不能被同步工具实时扫描。
> 否则同步工具会和 DSH 抢同一个文件，fork 出「冲突文件」，会话日志出现 `seq gap`，整个会话打不开。
> **这个插件就是被那次事故教出来的**（见文末「事故背景」）。

---

## 功能

- **自动推送**：一轮对话结束后，等 `debounceMs`，再确认文件安静 `idleMs`，才复制
- **安全判断**：`safeToPush` 为假时**拒绝推送**，并告诉你在等什么
- **设置页面板**：`设置 → 数据同步`，改云盘目录、开关自动推送、看状态、手动推/拉
- **危险配置拦截**：数据目录是联接、或云盘目录落在数据目录里 → 直接拒绝一切写入
- **拉取默认关闭**：`pull` 会覆盖本地，默认 `allowPull: false`，开了也会先备份

---

## 安装

```bash
dsh plugin --profile <你的 profile> add <本仓库地址或本地路径>
```

装完**重启 DSH**，然后进 **设置 → 数据同步**：

1. 填「云盘目录」（两台机器盘符不一样就各填各的）
2. 按「保存」
3. 之后它自己同步

---

## 配置

`~/.dsh/dsh-sync.json`（设置页保存的就是它）：

```json
{
  "cloudDir": "",
  "auto": true,
  "debounceMs": 5000,
  "idleMs": 8000,
  "allowPull": false,
  "dirs": ["sessions", "storages", "fish-memory", "feiyu-mood"]
}
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `cloudDir` | `""` | **必填**。同步到哪；留空时 push/pull 都会拒绝 |
| `auto` | `true` | 一轮结束后自动推送 |
| `debounceMs` | `5000` | 一轮结束到动手之间等多久 |
| `idleMs` | `8000` | 文件最后修改距今超过这么久，才认为「写完了」 |
| `allowPull` | `false` | 拉取会覆盖本地，默认关闭 |
| `dirs` | 四个目录 | 要同步哪些 |

---

## 接口

| 路由 | 作用 |
|---|---|
| `GET /dsh-sync/status` | 状态、待同步、是否安全、上次推送 |
| `GET /dsh-sync/push` | 立即推送（不安全时拒绝） |
| `GET /dsh-sync/pull` | 从副本拉取（默认关闭，先备份） |
| `GET /dsh-sync/config` / `POST` | 读 / 写配置 |
| `GET /dsh-sync/panel` | 独立状态页（设置页之外的后备入口） |

---

## 安全护栏

`status` 返回 `fatal` 与 `issues`。命中以下任一条，push/pull 全部拒绝：

1. 数据目录（`sessions` / `storages` / `fish-memory` / `feiyu-mood`）**是联接**
2. `cloudDir` **落在数据目录里面**

```json
{
  "fatal": true,
  "issues": [{ "dir": "sessions", "problem": "这是个联接（junction/symlink），指向别处…" }]
}
```

---

## 测试

```bash
npm test
```

六个套件、**71 条断言**，全部在**临时目录**里跑（`DSH_HOME` 指向系统临时目录，不碰真实数据）：

| 套件 | 守什么 |
|---|---|
| `readwrite` | 推送 / 拉取 / 安全拦截 / 备份 |
| `guard` | 联接检测、云盘在数据目录里 → 拒绝 |
| `config` | 配置读写、反斜杠统一、空值忽略、白名单字段 |
| `client` | 设置页槽位注册契约（`settings.section`） |
| `panel` | 独立状态页能返回可用 HTML |
| `unconfigured` | 没填云盘目录时：不推、不拉、给人话 |

---

## 事故背景

2026-10-26，作者曾用「目录联接 + 网盘实时同步」把 DSH 数据目录接到网盘上。
结果：百度网盘与 DSH 同时改同一个文件 → 生成冲突副本 → 会话日志分叉 →
`released v2 row 3146 has seq gap (expected 3146, got 3193)` → **会话打不开**。

数据最终救回来了，但这条教训写进了代码里：**护栏比功能重要。**

---

## 许可

MIT
