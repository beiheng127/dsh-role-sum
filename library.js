/**
 * dsh-role-sum —— 资产库 + 质检（纯函数层，不依赖宿主 API）
 *
 * 目录约定（每个角色一个文件夹）：
 *   <root>/<slug>/
 *     SKILL.md                 人格文档（给 agent 读的完整档案）
 *     persona.md               人设文档（给 dfy-qq 子人格用的短版，可选）
 *     manifest.json            元数据：名字/作品/来源/覆盖到哪天/质检分数/版本
 *     sources.json             手动挂进来的资料（角色-来源）
 *     references/raw/*.json    自动采集的原始资料（溯源依据）
 *     references/manual/*.md   手动贴进来的原文
 *     references/distillation.md 蒸馏笔记（可选）
 *     quality-report.json      最近一次质检结果
 *     history/<时间戳>/        每次更新前的旧版快照
 *   <root>/_trash/             删除的东西先搬这里，不真删
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
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

// ---- 手动资料（角色-来源）----

const sourcesPath = (dir) => join(dir, 'sources.json');
const manualDir = (dir) => join(dir, 'references', 'manual');

function listManual(dir) {
  try {
    return readdirSync(manualDir(dir)).filter((n) => n.endsWith('.md'));
  } catch {
    return [];
  }
}

function collectManualText(dir) {
  let text = '';
  for (const n of listManual(dir)) {
    try {
      text += readFileSync(join(manualDir(dir), n), 'utf8') + '\n';
    } catch {
      /* ignore */
    }
  }
  return text;
}

/** 一条资料：{id,title,url,note,kind,chars,addedAt} */
export function listSources(dir) {
  const j = readJson(sourcesPath(dir), null);
  const arr = j && Array.isArray(j.sources) ? j.sources : [];
  return arr.map((s) => ({
    ...s,
    chars: s.file ? fileSize(join(manualDir(dir), basename(s.file))) : 0,
  }));
}

/** 新增一条资料；content 非空就落成 references/manual/<id>.md，原文可溯源 */
export function addSource(dir, { title, url, note, content, kind } = {}) {
  const name = String(title || url || '').trim();
  if (!name) return { ok: false, error: '资料至少要有个标题或链接' };
  mkdirSync(dir, { recursive: true });
  mkdirSync(manualDir(dir), { recursive: true });
  const id = 'src-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let file = '';
  const body = String(content || '').trim();
  if (body) {
    file = id + '.md';
    const head = ['# ' + name, url ? '来源：' + url : '', note ? '备注：' + note : '', '抓取/录入：' + new Date().toISOString(), '']
      .filter(Boolean)
      .join('\n');
    writeFileSync(join(manualDir(dir), file), head + '\n' + body + '\n', 'utf8');
  }
  const cur = readJson(sourcesPath(dir), null) || { sources: [] };
  if (!Array.isArray(cur.sources)) cur.sources = [];
  const entry = {
    id,
    title: name,
    url: String(url || '').trim(),
    note: String(note || '').trim(),
    kind: String(kind || (url ? 'url' : 'note')),
    file,
    addedAt: new Date().toISOString(),
  };
  cur.sources.push(entry);
  writeJson(sourcesPath(dir), cur);
  return { ok: true, source: entry, file: file ? join(manualDir(dir), file) : '' };
}

/** 删一条资料：sources.json 里摘掉，对应 manual 文件一并删 */
export function removeSource(dir, id) {
  const cur = readJson(sourcesPath(dir), null) || { sources: [] };
  const arr = Array.isArray(cur.sources) ? cur.sources : [];
  const hit = arr.find((s) => String(s.id) === String(id));
  if (!hit) return { ok: false, error: '没有这条资料：' + id };
  cur.sources = arr.filter((s) => String(s.id) !== String(id));
  writeJson(sourcesPath(dir), cur);
  if (hit.file) {
    try {
      unlinkSync(join(manualDir(dir), basename(hit.file)));
    } catch {
      /* 文件没了就算了 */
    }
  }
  return { ok: true, removed: hit };
}

/** 删整个角色：不真删，搬到 <root>/_trash/<slug>-<ts>，后悔还能捞回来 */
export function deleteItem(root, slug) {
  const dir = join(root, slug);
  if (!existsSync(dir)) return { ok: false, error: '没有这个角色：' + slug };
  if (!slug || slug.startsWith('_')) return { ok: false, error: '这个目录不允许删' };
  const trash = join(root, '_trash');
  mkdirSync(trash, { recursive: true });
  const to = join(trash, slug + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
  renameSync(dir, to);
  return { ok: true, from: dir, to };
}

/** 资产库总览 */
export function scanLibrary(root) {
  let dirs = [];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
      .map((d) => d.name);
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
    const personaPath = join(dir, 'persona.md');
    return {
      slug,
      dir,
      name: manifest.name || firstLine || slug,
      work: manifest.work || '',
      chars,
      hasSkill: chars > 0,
      hasManifest: Boolean(manifest && Object.keys(manifest).length),
      rawCount: listRaw(dir).length,
      sourceCount: listSources(dir).length,
      manualCount: listManual(dir).length,
      hasPersona: existsSync(personaPath),
      personaChars: fileSize(personaPath),
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
  let persona = '';
  try {
    persona = readFileSync(join(dir, 'persona.md'), 'utf8');
  } catch {
    persona = '';
  }
  const files = [];
  const push = (relPath) => {
    const p = join(dir, relPath);
    if (existsSync(p)) files.push({ path: relPath, size: fileSize(p), at: mtime(p) });
  };
  push('SKILL.md');
  push('persona.md');
  push('manifest.json');
  push('sources.json');
  push('quality-report.json');
  push('references/distillation.md');
  for (const n of listRaw(dir)) push('references/raw/' + n);
  for (const n of listManual(dir)) push('references/manual/' + n);
  return {
    slug,
    dir,
    skill,
    persona,
    personaPreview: persona.slice(0, 4000),
    preview: skill.slice(0, 6000),
    manifest: readJson(join(dir, 'manifest.json'), null),
    sources: listSources(dir),
    report: readJson(join(dir, 'quality-report.json'), null),
    files,
  };
}

/** 更新前留档 */
export function snapshot(dir) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const to = join(dir, 'history', ts);
  mkdirSync(to, { recursive: true });
  for (const n of ['SKILL.md', 'manifest.json', 'persona.md']) {
    const src = join(dir, n);
    if (existsSync(src)) copyFileSync(src, join(to, n));
  }
  return to;
}

/** 把人设文档装进 personas/：persona.md 抄一份成 <personaRoot>/<file>.md */
export function installPersona(dir, personaRoot, fileName) {
  const src = join(dir, 'persona.md');
  if (!existsSync(src)) return { ok: false, error: '还没有 persona.md，先生成一份' };
  mkdirSync(personaRoot, { recursive: true });
  const name = String(fileName || basename(dir) + '.md').replace(/[\\/:*?"<>|]/g, '-');
  const to = join(personaRoot, name.endsWith('.md') ? name : name + '.md');
  copyFileSync(src, to);
  return { ok: true, to, chars: fileSize(to) };
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
  const rawText = collectRawText(dir) + collectManualText(dir);
  const rawNames = listRaw(dir);
  const manualNames = listManual(dir);
  const sourceTotal = rawNames.length + manualNames.length;

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
  const untraceable = sourceTotal === 0 ? [] : urls.filter((u) => !rawText.includes(u));
  ok(urls.length === 0 || untraceable.length === 0, 'untraceable-sources', 'warn', `${untraceable.length} 个引用在 references/ 里找不到对应原文`, '重新采集，或把这些结论降级为待确认');
  ok(sourceTotal >= 2, 'few-sources', 'warn', `原始资料只有 ${sourceTotal} 份（采集 ${rawNames.length} + 手动 ${manualNames.length}）`, '重要结论要两个独立来源，先补齐再下判断');
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
