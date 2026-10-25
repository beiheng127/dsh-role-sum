# role-sum —— 二次元角色人格总结

把二次元角色（或真人）的公开资料蒸馏成可复用的人格文档。工作流直接沿用 csp（Character_Skill_Producer）的固定结构。

## 何时用

- 想给某个角色做人格档案，之后让 AI 按这个人格说话
- 需要一份带来源、带检索日期的角色总结，而不是道听途说

## 固定工作流

1. **采集**：`role_sum_research "角色" [作品]`
   - 萌娘百科优先（`moegirl_api.py`）
   - 其次 Wikipedia / BWiki / B 站 / Google
   - 原始资料写进 `references/raw/`
2. **蒸馏**：按 csp 的六份研究稿写
   - `01-setting.md` 世界观与设定
   - `02-personality.md` 性格
   - `03-expression.md` 语言风格
   - `04-relationships.md` 关系
   - `05-key-scenes.md` 关键场景
   - `06-media-coverage.md` 媒体覆盖
3. **产出**：`SKILL.md` + `manifest.json` + `references/{sources.json,distillation.md,quality-report.json}`

## 来源规则

- 官方材料 > 萌娘百科 / Wikipedia / Fandom > Bangumi / AniDB / BWiki / B 站专栏 > 粉丝讨论
- 不用知乎、微信公众号、百度百科
- 重要结论至少两个独立来源
- 每条都写检索日期与 `covered_until`
- 信息不足就写 `honesty_boundary`，不许编

## 输出布局

```
<输出目录>/<slug>/
├── SKILL.md
├── manifest.json
└── references/
    ├── sources.json
    ├── distillation.md
    ├── quality-report.json
    ├── raw/{source-search,moegirl,bwiki}.json
    └── research/{01-setting,02-personality,03-expression,04-relationships,05-key-scenes,06-media-coverage}.md
```

## 依赖

- 本机 Python 3
- csp skill：`~/.dsh/skills/csp`（设置页点「安装 Skill」或用 `role_sum_install_skill`）
