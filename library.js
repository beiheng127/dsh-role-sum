/**
 * dsh-role-sum —— 资产库 + 质检（纯函数层，不依赖宿主 API）
 *
 * 目录约定（每个角色一个文件夹）：
 *   <root>/<slug>/
 *     SKILL.md                 人格文档（可直接装进 personas/）
 *     manifest.json            元数据：名字/作品/来源/覆盖到哪天/质检分数/版本
 *     references/raw/*.json    采集到的原始资料（溯源依据）
 *     references/distillation.md 蒸馏笔记（可选）
 *     quality-report.json      最近一次质检结果
 *     history/<时间戳>/        每次更新前的旧版快照
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

export function readJson(p, fallback) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(p, obj) {
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

export function slugify(s) {
  const raw = String(s || '').trim();
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    const ascii = code < 128;
    if (ascii) {
      if (/[A-Za-z0-9]/.test(ch)) out += ch;
      else if (/[\s_\-—/：:·.,，。]/.test(ch)) out += '-';
    } else {
      out += ch;
    }
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'role-' + Date.now().toString(36);
}

/** 各目录解析：全部来自配置，界面上能改 */
export function layout({ workspace, outputDir, personaDir }) {
  const root = resolve(workspace, outputDir || 'role-sums');
  const personaRoot = resolve(workspace, personaDir || 'personas');
  return { root, personaRoot };
}

const fileSize = (p) => {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
};
const mtime = (p) => {
  try {
    return statSync(p).mtime.toISOString();
  } catch {
    return '';
  }
};

function listRaw(dir) {
  const rawDir = join(dir, 'references', 'raw');
  try {
    return readdirSync(rawDir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
}

function collectRawText(dir) {
  const rawDir = join(dir, 'references', 'raw');
  let text = '';
  for (const n of listRaw(dir)) {
    try {
      text += readFileSync(join(rawDir, n), 'utf8') + '\n';
    } catch {
      /* 单个文件读不了就跳过 */
    }
  }
  return text;
}

/** 资产库总览 */
export function scanLibrary(root) {
  let dirs = [];
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return { root, exists: false, items: [] };
  }
  const items = dirs.map((slug) => {
    const dir = join(root, slug);
    const skillPath = join(dir, 'SKILL.md');
    const manifest = readJson(join(dir, 'manifest.json'), null) || {};
    const report = readJson(join(dir, 'quality-report.json'), null) || null;
    let chars = 0;
    let skillText = '';
    try {
      skillText = readFileSync(skillPath, 'utf8');
      chars = skillText.length;
    } catch {
      /* 没有 SKILL.md 就是半成品 */
    }
    const historyDir = join(dir, 'history');
    let versions = 0;
    try {
      versions = readdirSync(historyDir).length;
    } catch {
      versions = 0;
    }
    const firstLine = (skillText.split(/\r?\n/).find((l) => l.trim().startsWith('# ')) || '').replace(/^#\s*/, '').trim();
    return {
      slug,
      dir,
      name: manifest.name || firstLine || slug,
      work: manifest.work || '',
      chars,
      hasSkill: chars > 0,
      hasManifest: Boolean(manifest && Object.keys(manifest).length),
      rawCount: listRaw(dir).length,
      updatedAt: manifest.updatedAt || mtime(skillPath),
      coveredUntil: manifest.coveredUntil || '',
      quality: report ? { score: report.score, level: report.level, checkedAt: report.checkedAt } : null,
      versions,
    };
  });
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { root, exists: true, items };
}

/** 单个角色的完整资料（给界面预览） */
export function readItem(root, slug) {
  const dir = join(root, slug);
  if (!existsSync(dir)) return null;
  const skillPath = join(dir, 'SKILL.md');
  let skill = '';
  try {
    skill = readFileSync(skillPath, 'utf8');
  } catch {
    skill = '';
  }
  const files = [];
  const push = (relPath) => {
    const p = join(dir, relPath);
    if (existsSync(p)) files.push({ path: relPath, size: fileSize(p), at: mtime(p) });
  };
  push('SKILL.md');
  push('manifest.json');
  push('quality-report.json');
  push('references/distillation.md');
  for (const n of listRaw(dir)) push('references/raw/' + n);
  return {
    slug,
    dir,
    skill,
    preview: skill.slice(0, 6000),
    manifest: readJson(join(dir, 'manifest.json'), null),
    report: readJson(join(dir, 'quality-report.json'), null),
    files,
  };
}

/** 更新前留档 */
export function snapshot(dir) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const to = join(dir, 'history', ts);
  mkdirSync(to, { recursive: true });
  for (const n of ['SKILL.md', 'manifest.json']) {
    const src = join(dir, n);
    if (existsSync(src)) copyFileSync(src, join(to, n));
  }
  return to;
}

/**
 * 静态质检：判的是「这份文档能不能自证」——来源、日期、边界、口吻样本、可溯源。
 * 模型层的反复检查由 agent 调 role_sum_check 做（同一条规则集，可循环到过）。
 */
export function qualityCheck(dir) {
  const issues = [];
  const skillPath = join(dir, 'SKILL.md');
  let skill = '';
  try {
    skill = readFileSync(skillPath, 'utf8');
  } catch {
    skill = '';
  }
  const manifest = readJson(join(dir, 'manifest.json'), null) || {};
  const rawText = collectRawText(dir);
  const rawNames = listRaw(dir);

  const add = (code, level, message, hint) => issues.push({ code, level, message, hint });
  const ok = (cond, code, level, message, hint) => (cond ? null : add(code, level, message, hint));

  ok(skill.length >= 600, 'doc-too-short', 'error', `SKILL.md 只有 ${skill.length} 字，撑不起一个人格`, '按 csp 工作流补齐「她是谁/行为逻辑/表达质感/台词样本/诚实边界」');
  ok(Boolean(manifest.name) && Boolean(manifest.work), 'manifest-incomplete', 'warn', 'manifest.json 缺 name 或 work', '补 name / work 字段，界面上才好认');
  const hasDate = /20\d{2}[-/年]\d{1,2}/.test(skill) || (Array.isArray(manifest.sources) && manifest.sources.length > 0);
  ok(hasDate, 'no-date', 'error', '没有检索日期，无法判断资料新旧', '写「资料检索于 2026-10-25」并记 coveredUntil');
  const hasBoundary = /诚实边界|边界|未覆盖|不确定|资料缺口|honesty/i.test(skill);
  ok(hasBoundary, 'no-boundary', 'error', '没写知识边界，等于宣称什么都知道', '加一段「不知道什么/资料停在哪」');
  const quotes = (skill.match(/^[ \t]*[-*]\s*[「“"']/gm) || []).length + (skill.match(/[「“][^」”]{6,}[」”]/g) || []).length;
  ok(quotes >= 3, 'few-quotes', 'warn', `台词/口吻样本只有 ${quotes} 条`, '至少 3 条能直接学的样本，官方原文优先');
  const urls = Array.from(new Set((skill.match(/https?:\/\/[^\s)）]+/g) || [])));
  const untraceable = urls.filter((u) => !rawText.includes(u) && !rawNames.length);
  ok(urls.length === 0 || untraceable.length === 0, 'untraceable-sources', 'warn', `${untraceable.length} 个引用在 references/raw 里找不到对应原文`, '重新采集，或把这些结论降级为待确认');
  ok(rawNames.length >= 2, 'few-sources', 'warn', `原始资料只有 ${rawNames.length} 份`, '重要结论要两个独立来源，先补齐再下判断');
  const todo = (skill.match(/待补充|TODO|待定|占位/g) || []).length;
  ok(todo <= 3, 'too-many-todos', 'warn', `还有 ${todo} 处待补充`, '要么补上，要么删掉别留着糊人');

  const total = 9;
  const failed = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  const score = Math.max(0, Math.round(((total - failed * 2 - warns) / total) * 100));
  const level = score >= 80 ? 'ok' : score >= 55 ? 'warn' : 'fail';
  return {
    slug: basename(dir),
    checkedAt: new Date().toISOString(),
    score,
    level,
    passed: issues.length === 0,
    errorCount: failed,
    warnCount: warns,
    issues,
    rules: total,
  };
}

export function writeReport(dir, report) {
  writeJson(join(dir, 'quality-report.json'), report);
  return report;
}
