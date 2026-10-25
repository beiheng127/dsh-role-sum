# dsh-role-sum

DSH 插件：二次元角色（或真人）人格总结。采集公开资料 → 按 csp 固定工作流蒸馏成可复用的人格文档。

## 功能

- `role_sum_research(role, work?)`：萌娘百科优先采集，其次百科 / BWiki / B 站，原始资料落盘
- `role_sum_install_skill()`：一键 `git clone` Character_Skill_Producer 到 `~/.dsh/skills/csp`
- `role_sum_list()`：列出已生成的人格文档
- 设置页「角色总结」：开关、输出目录、csp 路径、python 路径、安装 / 保存

## 安装

1. 把本目录放进 `~/.dsh/plugins/dsh-role-sum`
2. 在 profile 里登记（`cordis.patch.yml` 已带 insert）
3. 重启 DSH，设置页出现「角色总结」

## 配置

覆盖文件 `~/.dsh/role-sum-config.json`：

```json
{
  "enabled": true,
  "outputDir": "role-sums",
  "cspSkillPath": "~/.dsh/skills/csp",
  "python": "python",
  "preferMoegirl": true,
  "maxResearchChars": 20000
}
```

## HTTP

- `GET  /api/role-sum/status`
- `POST /api/role-sum/config`
- `POST /api/role-sum/install-skill`
- `POST /api/role-sum/research`（`{role, work}`）

## 来源优先级

官方材料 > 萌娘百科 / Wikipedia / Fandom > Bangumi / AniDB / BWiki / B 站专栏 > 粉丝讨论。排除知乎、微信公众号、百度百科。
