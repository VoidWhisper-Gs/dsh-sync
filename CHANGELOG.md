# 更新记录

## 0.2.1

- 设置页加「允许从网盘拉取」开关（默认关；拉取会覆盖本地，只建议启动时用一次）
- README 顶部加徽章

## 0.2.0

- **设置页**：「数据同步」面板（云盘目录输入框、自动推送开关、状态卡片、推送/拉取按钮）
- 新增 `POST /dsh-sync/config`：改云盘目录 / auto / allowPull 等，字段白名单，反斜杠自动统一
- `cloudDir` 改为**必填**：未配置时 push/pull 都拒绝，并给出人话提示
- 新增独立状态页 `GET /dsh-sync/panel`（设置页之外的后备入口）

## 0.1.1

- **安全护栏**：数据目录是联接（junction/symlink）、或云盘目录落在数据目录里 → `fatal: true`，push/pull 全部拒绝
- 起因：2026-10-26 的会话损坏事故（`seq gap`）

## 0.1.0

- 初始版本：`/dsh-sync/status`、`/push`、`/pull`
- 一轮结束（`agent/turn-stopping`）后防抖推送；文件安静 `idleMs` 才动手
- 拉取默认关闭；拉取前备份到 `~/.dsh/_backup-before-pull/<时间>/`
