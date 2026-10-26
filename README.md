# dsh-role-sum

DSH 插件：二次元角色（或真人）人格总结。采集公开资料 → 按 [csp](https://github.com/qian-gugugaga/Character_Skill_Producer) 固定工作流蒸馏成可复用的人格文档，并长期管理这些文档。

## 已知崩溃与修复（0.3.2）

**症状**：插件启用后重启，桌面端弹 `desktop welcome: Web RPC failed`，应用进不去。

**根因**：宿主设置服务里是这样取插件 schema 的（`@deepseek-ai/dsh-settings/lib/types/index.js`）：

```js
schema(entry) {
  const schema = entry.fiber?.runtime?.Config;
  return schema !== undefined && 'toJSON' in schema ? schema : undefined;
}
```

`@deepseek-ai/schemastery` 是可选 peer，装不上时旧代码 `export const Config = z && z.object({...})`
会导出 `null`，于是 `'toJSON' in null` 抛 `TypeError: Cannot use 'in' operator to search for 'toJSON' in null`，
`settings/describe` 整个 RPC 失败 → 桌面端开窗即崩。

**修法**：schemastery 缺失时退化成最小 standard-schema（有 `~standard.validate`，
没有 `toJSON`，设置服务会干净地跳过它），不再导出 `null`；
另外在本机 `node_modules/@deepseek-ai/schemastery` 建了到 profile 的 junction，设置表单照常有。

## 比裸 skill 多了什么

| 能力 | 说明 |
| --- | --- |
| 采集 | 萌娘百科优先 → 百科 / BWiki / B 站 / Google 兜底，原始资料落盘可溯源 |
| 资产库 | 每个角色一个文件夹，索引名字 / 作品 / 字数 / 覆盖日期 / 质检分 / 历史版本 |
| 质检 | 来源、检索日期、知识边界、台词样本、可溯源；不合格列待修项，可反复复查 |
| 手动更新 | 设置页点「更新新剧情」→ 开一个会话让 agent 去搜新增剧情、改文档、自己跑质检；旧版先快照 |
| 目录可配 | 资产库根、personas 目录、csp 目录、python 路径、质检轮数，全在设置页改 |

## 目录结构

```
<资产库根>/<slug>/
  SKILL.md                 人格文档（可直接装进 personas/）
  manifest.json            名字 / 作品 / 来源 / 覆盖到哪天 / 质检分
  references/raw/*.json    采集到的原始资料（溯源依据）
  references/distillation.md
  quality-report.json      最近一次质检结果
  history/<时间戳>/        每次更新前的旧版快照
```

## 工具

- `role_sum_research(role, work?)`：采集，写入 `references/raw/`，返回目录与固定工作流下一步
- `role_sum_check(slug)`：跑质检，落 `quality-report.json`，返回分数 / 等级 / 待修项
- `role_sum_library()`：资产库总览
- `role_sum_list()`：目录路径 + 已生成项
- `role_sum_install_skill()`：一键 `git clone` Character_Skill_Producer 到 csp 目录

## 安装

1. 把本目录放到 `~/.dsh/plugins/dsh-role-sum`
2. profile 的 `package.json` 加 `"dsh-role-sum": "link:<本目录>"`，并把 `dsh-role-sum` 加进 `dsh.profile.bundles`
3. `cordis.patch.yml` 由插件自带的 `dsh.bundle.patch` 提供 insert
4. 重启 DSH，设置页出现「角色总结」

## 配置

覆盖文件 `~/.dsh/role-sum-config.json`：

```json
{
  "enabled": true,
  "outputDir": "role-sums",
  "personaDir": "personas",
  "cspSkillPath": "~/.dsh/skills/csp",
  "python": "python",
  "preferMoegirl": true,
  "maxResearchChars": 20000,
  "qualityRounds": 2
}
```

`outputDir` / `personaDir` 相对 profile 工作区；`cspSkillPath` 支持 `~`。

## HTTP

前缀 `/api/role-sum`：

- `GET  /status` 配置 + 路径 + csp 状态
- `GET  /library` 资产库总览
- `GET  /item?slug=` 单个角色（SKILL.md、manifest、质检报告、文件清单、目录）
- `POST /config` 改配置（只认已知字段）
- `POST /install-skill` 安装 csp
- `POST /research` `{role, work}`
- `POST /check` `{slug}`
- `POST /update` `{slug, focus}`

## 来源优先级

官方材料 > 萌娘百科 / Wikipedia / Fandom > Bangumi / AniDB / BWiki / B 站专栏 > 粉丝讨论。排除知乎、微信公众号、百度百科。重要结论要两个独立来源，信息不足写进边界。

## 0.3.0 新增

**资料（角色-来源）可以自己加、自己删**
- 设置页每个角色展开后能看到「资料」列表：标题、链接、备注、正文字数
- 新增表单四栏：标题 / 链接 / 备注 / 正文。正文粘进去就落成 `references/manual/<id>.md`；只给链接也行，当线索记着
- 删资料连正文文件一起删，`sources.json` 同步
- 质检的来源数把「采集到的 raw」和「你手动加的」一起算，引用能对上手头原文才算可溯源

**删除角色**
- 两步确认；删的是搬到 `<资产库>/_trash/<slug>-<时间戳>`，不是真删
- 下划线开头的目录（含 `_trash`）不允许删

**人设联动（接 dfy-qq 的子人格）**
- 「生成人设」：把资产库里的资料再总结成一份 `persona.md`，固定结构（一句话 / 她是谁 / 运行核心 / 表达质感 / 台词样本 / 什么时候上 / 绝不做 / 诚实边界），1500–2500 字
- 「装进 personas」：直接写进 `personas/99-<角色>.md`，子人格列表里立刻能选
- 生成前自动快照，写坏了能回滚

**python 路径那一栏填什么**
- 填 `python` 就用系统 PATH 里那个
- 装了多个版本、或者 PATH 没配好，就填绝对路径，例如 `C:\Python312\python.exe`

**目录设置**
| 项 | 默认值 | 作用 |
| --- | --- | --- |
| outputDir | role-sums | 资产库，每个角色一个文件夹 |
| personaDir | personas | 生成的人设文档装哪 |
| cspSkillPath | ~/.dsh/skills/csp | Character Skill Producer 脚本所在 |
| python | python | 跑 csp 脚本解释器 |
| qualityRounds | 2 | 生成/更新后反复自检的轮数 |
