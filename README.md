# dsh-role-sum

DSH 插件：二次元角色（或真人）人格总结。采集公开资料 → 按 [csp](https://github.com/qian-gugugaga/Character_Skill_Producer) 固定工作流蒸馏成可复用的人格文档，并长期管理这些文档。

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
