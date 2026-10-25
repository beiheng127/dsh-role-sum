/**
 * dsh-role-sum —— 二次元角色总结插件（宿主半端）
 *
 * 1. 资料采集：萌娘百科优先 → Wikipedia / BWiki / B站 / Google 兜底
 * 2. 固定工作流：交给 csp（Character_Skill_Producer）skill 蒸馏成人格文档
 * 3. 一键安装：git clone Character_Skill_Producer 到 skills/csp
 * 4. 设置页：/api/role-sum/* + client.js
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addSource,
  deleteItem,
  installPersona,
  layout,
  listSources,
  qualityCheck,
  readItem,
  removeSource,
  scanLibrary,
  snapshot,
  writeReport,
} from './library.js';

let defineTool = (options) => options;
try {
  ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
} catch {
  /* optional peer */
}

let z = null;
try {
  const mod = await import('@deepseek-ai/schemastery');
  z = mod.default ?? mod;
} catch {
  /* 退化成普通对象 */
}

const HOME = homedir();
const SEP = String.fromCharCode(92);

const CSP_REPO = 'https://github.com/qian-gugugaga/Character_Skill_Producer.git';
const OVERRIDE_PATH = join(HOME, '.dsh', 'role-sum-config.json');

const DEFAULTS = {
  enabled: true,
  workspace: '',
  outputDir: 'role-sums',
  personaDir: 'personas',
  cspSkillPath: '~/.dsh/skills/csp',
  python: 'python',
  preferMoegirl: true,
  maxResearchChars: 20000,
  qualityRounds: 2,
};

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function expandHome(p) {
  const s = String(p || '').trim();
  if (!s) return s;
  if (s === '~') return HOME;
  if (s.startsWith('~/') || s.startsWith('~' + SEP)) return join(HOME, s.slice(2));
  return s;
}

function slugify(name) {
  let out = '';
  for (const ch of String(name || '')) {
    const code = ch.codePointAt(0) || 0;
    const isAscii =
      (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const isCjk = code >= 0x4e00 && code <= 0x9fff;
    if (isAscii || isCjk || ch === '-' || ch === '_') out += ch;
    else if (out && !out.endsWith('-')) out += '-';
  }
  const trimmed = out.replace(/^-+/, '').replace(/-+$/, '').slice(0, 60);
  return trimmed || 'role-' + Date.now().toString(36);
}

function run(bin, args, opts) {
  return new Promise((res) => {
    execFile(
      bin,
      args,
      {
        cwd: opts && opts.cwd,
        timeout: (opts && opts.timeout) || 120000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        // Windows 下 python 默认按 ANSI(GBK) 解码 argv，中文角色名会变乱码；
        // PYTHONUTF8 让子进程强制 UTF-8，git 等其它命令不受影响。
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      },
      (err, stdout, stderr) => {
        res({
          ok: !err,
          code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: err ? String(err.message || err) : '',
        });
      },
    );
  });
}

function parseJsonLoose(text) {
  const s = String(text || '').trim();
  try {
    return JSON.parse(s);
  } catch {
    /* 尝试截取第一个 JSON 对象 */
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function sameOrigin(req) {
  const origin = req.headers && (req.headers.origin || req.headers.referer);
  if (!origin) return true;
  try {
    const u = new URL(String(origin));
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  } catch {
    return false;
  }
}

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/** 造一条 llm 形状的 user 消息：followup 只认这一种，缺 role/id 会被静默丢掉 */
function makeUserMessage(text) {
  const id =
    globalThis.crypto?.randomUUID?.() ||
    'rs-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2);
  return Object.freeze({
    id,
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text: String(text) })]),
    source: Object.freeze({ kind: 'plugin:dsh-role-sum' }),
  });
}

function readBody(req) {  return new Promise((res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => res(parseJsonLoose(raw) || {}));
    req.on('error', () => res({}));
  });
}

export const name = 'dsh-role-sum';
export const inject = ['tools', 'systemPrompt', 'webServer'];

export const Config =
  z &&
  z.object({
    enabled: z.boolean().default(true).description('启用角色总结插件'),
    workspace: z.string().default('').description('工作区根目录（绝对路径；留空则用宿主给的工作区）'),
    outputDir: z.string().default('role-sums').description('资产库根目录（相对工作区）'),
    personaDir: z.string().default('personas').description('人格文档目录（把 SKILL.md 装进这里用）'),
    cspSkillPath: z.string().default('~/.dsh/skills/csp').description('csp skill 所在目录'),
    python: z.string().default('python').description('python 可执行文件'),
    preferMoegirl: z.boolean().default(true).description('优先萌娘百科'),
    maxResearchChars: z.number().default(20000).description('单次采集最多返回给模型的字符数'),
    qualityRounds: z.number().default(2).description('更新/质检时允许反复修几轮'),
  });

export function apply(ctx, rawConfig = {}) {
  let cfg = { ...DEFAULTS, ...(rawConfig || {}), ...readJson(OVERRIDE_PATH, {}) };

  const workspace = () => {
    const c = ctx.get?.('workspace');
    const dir = c && (c.path || c.root || c.dir);
    return dir ? String(dir) : process.cwd();
  };

  const cspDir = () => expandHome(cfg.cspSkillPath);
  const cspReady = () => existsSync(join(cspDir(), 'SKILL.md'));
  const script = (n) => join(cspDir(), 'scripts', n);
  // 宿主给的是 profile 目录（…\.dsh\profiles\desktop），不是用户工作区；
  // 所以这里优先用配置里的绝对路径，填了才算数。
  const workspaceRoot = () => {
    const w = String(cfg.workspace || '').trim();
    return w ? expandHome(w) : workspace();
  };
  const outputRoot = () => resolve(workspaceRoot(), cfg.outputDir || 'role-sums');

  const paths = () =>
    layout({ workspace: workspaceRoot(), outputDir: cfg.outputDir, personaDir: cfg.personaDir });
  const dirOf = (slug) => join(paths().root, String(slug || ''));
  const library = () => scanLibrary(paths().root);

  const check = (slug) => {
    const dir = dirOf(slug);
    if (!existsSync(join(dir, 'SKILL.md'))) {
      return { ok: false, error: '资产库里没有这个角色，或还没有 SKILL.md：' + slug };
    }
    const report = qualityCheck(dir);
    writeReport(dir, report);
    return { ok: true, dir, report };
  };

  const agentService = () => {
    try {
      return ctx.get?.('agents') || null;
    } catch {
      return null;
    }
  };

  /**
   * 手动更新：开一个真实会话去搜新剧情，agent 自己改文档、自己跑质检。
   * 旧版先快照进 history/，改坏了能翻回去。
   */
  const startUpdateSession = async (slug, focus) => {
    const dir = dirOf(slug);
    if (!existsSync(dir)) return { ok: false, error: '资产库里没有这个角色：' + slug };
    if (!cspReady()) return { ok: false, error: 'csp skill 未安装，先装再更新' };
    const agents = agentService();
    if (!agents) return { ok: false, error: '宿主没提供 agents 服务，开不了对话' };
    const snap = snapshot(dir);
    const item = readItem(paths().root, slug);
    const meta = item && item.manifest ? item.manifest : {};
    const selection = (() => {
      try {
        return ctx.get?.('agentDefaultModel')?.currentSelection?.() || null;
      } catch {
        return null;
      }
    })();
    const agentOptions = selection ? { provider: selection.provider, model: selection.model } : {};
    const sessionId = 'role-sum-update-' + String(slug).replace(/[^A-Za-z0-9\u4e00-\u9fff-]/g, '-') + '-' + Date.now().toString(36);
    const handle = await agents.create({ sessionId, meta: { cwd: workspaceRoot() }, agentOptions });
    try {
      await handle.agent?.whenIdle?.();
    } catch {
      /* ignore */
    }
    const prompt = [
      '[角色档案更新任务]',
      '目标角色：' + (meta.name || slug) + (meta.work ? '（' + meta.work + '）' : ''),
      '档案目录：' + dir,
      '上次覆盖到：' + (meta.coveredUntil || '未记录'),
      focus ? '本次特别关注：' + focus : '',
      '',
      '按这个顺序做，别跳步：',
      '1. 先调 role_sum_research 重新采集公开资料（萌娘百科优先，其次百科/BWiki/B站/Google），拿到的原文留在 references/raw/',
      '2. 和现有 SKILL.md 逐条比对：只把「上次覆盖日期之后的新剧情/新语音/新设定」补进去，旧结论不要无故改写',
      '3. 更新 manifest.json：updatedAt、coveredUntil、sources；旧的 SKILL.md 已经自动备份在 history/，写之前可以对照',
      '4. 调 role_sum_check 跑质检，按 issues 一条条改，最多 ' + (Number(cfg.qualityRounds) || 2) + ' 轮，直到 level 是 ok',
      '5. 实在没搜到新东西，就在文档里写「截至 <日期> 未见新增剧情」，别硬编。',
      '全程中文，改完把「改了什么/没找到什么」一句话交代清楚。',
    ]
      .filter(Boolean)
      .join('\n');
    handle.agent.followup(makeUserMessage(prompt));
    return { ok: true, sessionId, snapshot: snap, dir, prompt };
  };

  /**
   * 生成人设文档：把资产库里的 SKILL.md + 全部资料再蒸馏成一份「能直接给对话用」的短人设，
   * 写进 <slug>/persona.md；之后再一键装进 personas/ 给子人格用。
   */
  const startPersonaSession = async (slug, opts = {}) => {
    const dir = dirOf(slug);
    if (!existsSync(join(dir, 'SKILL.md'))) return { ok: false, error: '资产库里没有这个角色的 SKILL.md：' + slug };
    const agents = agentService();
    if (!agents) return { ok: false, error: '宿主没提供 agents 服务，开不了对话' };
    snapshot(dir);
    const item = readItem(paths().root, slug);
    const meta = (item && item.manifest) || {};
    const fileName = String(opts.fileName || slug).replace(/\.md$/i, '');
    const selection = (() => {
      try {
        return ctx.get?.('agentDefaultModel')?.currentSelection?.() || null;
      } catch {
        return null;
      }
    })();
    const agentOptions = selection ? { provider: selection.provider, model: selection.model } : {};
    const sessionId =
      'role-sum-persona-' + String(slug).replace(/[^A-Za-z0-9\u4e00-\u9fff-]/g, '-') + '-' + Date.now().toString(36);
    const handle = await agents.create({ sessionId, meta: { cwd: workspaceRoot() }, agentOptions });
    try {
      await handle.agent?.whenIdle?.();
    } catch {
      /* ignore */
    }
    const outFile = join(dir, 'persona.md');
    const prompt = [
      '[人设文档生成任务]',
      '角色：' + (meta.name || slug) + (meta.work ? '（' + meta.work + '）' : ''),
      '资产库目录：' + dir,
      '',
      '先读这些再动笔：SKILL.md、manifest.json、references/raw/ 与 references/manual/ 里全部原文、sources.json。',
      '目标：1500~2500 字的短人设，给对话里的子人格用。它不是档案摘要，它回答「怎么扮演她」。',
      '写进 ' + outFile + '，结构固定：',
      '# ' + fileName,
      '> 一句话：她跟别人到底哪儿不一样',
      '## 她是谁（3~5 句，只留会影响说话方式的设定）',
      '## 运行核心（3~5 条行为铁律，判断句，不要形容词堆砌）',
      '## 表达质感（句长、语气词、称呼、什么时候收着）',
      '## 台词样本（官方原文优先，每条标来源；没有原文的标「蒸馏」）',
      '## 什么时候上（什么语境切她）',
      '## 绝不做（会把人设演崩的点）',
      '## 诚实边界（资料覆盖到哪天、什么不知道）',
      '',
      '规矩：只写有来源的东西；推理标注「推测」；不要整段照抄 SKILL.md。',
      '写完调 role_sum_check（slug 用 ' + slug + '）看分数，低于 80 就按 issues 改。',
      '最后回一句：名字 + 字数 + 质检分。',
    ].join('\n');
    handle.agent.followup(makeUserMessage(prompt));
    return { ok: true, sessionId, dir, file: outFile, prompt };
  };

  const saveConfig = (patch) => {
    const cur = { ...readJson(OVERRIDE_PATH, {}) };
    for (const k of Object.keys(DEFAULTS)) if (patch && k in patch) cur[k] = patch[k];
    writeJson(OVERRIDE_PATH, cur);
    cfg = { ...DEFAULTS, ...cur };
    return cfg;
  };

  const listOutputs = () => {
    const root = outputRoot();
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const dir = join(root, d.name);
          const skill = join(dir, 'SKILL.md');
          return { slug: d.name, dir, hasSkill: existsSync(skill) };
        });
    } catch {
      return [];
    }
  };

  const installSkill = async () => {
    const dir = cspDir();
    if (cspReady()) return { ok: true, existed: true, dir, message: 'csp skill 已存在' };
    mkdirSync(dirname(dir), { recursive: true });
    const r = await run('git', ['clone', '--depth', '1', CSP_REPO, dir], { timeout: 180000 });
    if (!r.ok && !existsSync(join(dir, 'SKILL.md'))) {
      return { ok: false, dir, error: (r.stderr || r.error || 'git clone 失败').slice(0, 800) };
    }
    return {
      ok: cspReady(),
      existed: false,
      dir,
      message: cspReady() ? '安装完成' : '克隆完成但没找到 SKILL.md',
    };
  };

  const collect = async (role, work) => {
    const slug = slugify(role + (work ? '-' + work : ''));
    const dir = join(outputRoot(), slug);
    const rawDir = join(dir, 'references', 'raw');
    mkdirSync(rawDir, { recursive: true });

    const steps = [];
    const py = cfg.python || 'python';

    if (existsSync(script('source_search.py'))) {
      const args = [script('source_search.py'), role];
      if (work) args.push('--work', work);
      args.push('--mode', 'discover');
      const r = await run(py, args, { cwd: cspDir() });
      const j = parseJsonLoose(r.stdout) || { ok: r.ok, raw: r.stdout.slice(0, 4000) };
      writeJson(join(rawDir, 'source-search.json'), j);
      steps.push({
        step: 'source_search',
        ok: r.ok,
        sources: Array.isArray(j.sources) ? j.sources.length : 0,
      });
    }

    if (cfg.preferMoegirl && existsSync(script('moegirl_api.py'))) {
      let r = await run(py, [script('moegirl_api.py'), role, '--full'], { cwd: cspDir() });
      let j = parseJsonLoose(r.stdout) || { ok: r.ok };
      const weak =
        !j.ok ||
        Number(j.extract_chars || 0) < 200 ||
        /可以指|消歧义/.test(String(j.extract || '').slice(0, 200));
      if (weak) {
        // 撞上消歧义页（如「祀」→ 祀可以指…）时，带作品名再搜一次，按命中标题重取
        const shortWork = String(work || '').replace(/^.*[：:]/, '').trim();
        const q = shortWork ? role + ' ' + shortWork : role;
        const s = await run(py, [script('moegirl_api.py'), q, '--search'], { cwd: cspDir() });
        const sj = parseJsonLoose(s.stdout) || {};
        const cands = Array.isArray(sj.candidates) ? sj.candidates : [];
        const pick =
          cands.find((c) => {
            const t = typeof c === 'string' ? c : c.title || '';
            return t.includes(role) && (!shortWork || t.includes(shortWork));
          }) || (sj.resolved_title && sj.resolved_title !== role ? sj.resolved_title : null) || cands[0];
        const title =
          typeof pick === 'string' ? pick : pick && (pick.title || pick.resolved_title || '');
        if (title) {
          const r2 = await run(py, [script('moegirl_api.py'), title, '--full'], { cwd: cspDir() });
          const j2 = parseJsonLoose(r2.stdout) || {};
          if (j2.ok && Number(j2.extract_chars || 0) > Number(j.extract_chars || 0)) {
            r = r2;
            j = j2;
            j.retried_title = title;
          }
        }
      }
      writeJson(join(rawDir, 'moegirl.json'), j);
      steps.push({
        step: 'moegirl',
        ok: Boolean(j.ok),
        resolved: j.resolved_title || j.resolved || j.title || '',
        chars: Number(j.extract_chars || 0),
      });
    }

    if (existsSync(script('bwiki_api.py'))) {
      const r = await run(py, [script('bwiki_api.py'), role, '--work', work || ''], { cwd: cspDir() });
      const j = parseJsonLoose(r.stdout) || { ok: r.ok, raw: r.stdout.slice(0, 2000) };
      writeJson(join(rawDir, 'bwiki.json'), j);
      steps.push({ step: 'bwiki', ok: r.ok });
    }

    return { dir, rawDir, slug, steps };
  };

  // ---- 工具 ----
  const tool = (toolName, description, parameters, execute) =>
    ctx.tools.register(
      defineTool({
        name: toolName,
        description,
        parameters,
        output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
        execute,
      }),
    );

  tool(
    'role_sum_research',
    '采集一个二次元角色（或真人）的公开资料：萌娘百科优先，其次百科/BWiki，写入 references/raw/，并返回下一步固定工作流。',
    {
      type: 'object',
      properties: {
        role: { type: 'string', description: '角色名，例如 芙宁娜' },
        work: { type: 'string', description: '所属作品，例如 原神（可空）' },
      },
      required: ['role'],
      additionalProperties: false,
    },
    async (args) => {
      if (!cfg.enabled) return '插件未启用：先在设置里打开 dsh-role-sum';
      if (!cspReady()) return 'csp skill 还没装：先调 role_sum_install_skill，或在设置页点「安装 Skill」';
      const role = String(args.role || '').trim();
      if (!role) return '缺少角色名';
      const work = String(args.work || '').trim();
      const out = await collect(role, work);
      return JSON.stringify(
        {
          ok: true,
          role,
          work,
          dir: out.dir,
          steps: out.steps,
          next: [
            '1. 读 references/raw/ 里的原始资料，先列来源与检索日期',
            '2. 按 csp 固定工作流蒸馏：01-setting / 02-personality / 03-expression / 04-relationships / 05-key-scenes / 06-media-coverage',
            '3. 重要结论至少两个独立来源；信息不足就写 honesty_boundary',
            '4. 产出 SKILL.md + manifest.json + references/distillation.md + sources.json + quality-report.json',
          ],
        },
        null,
        2,
      );
    },
  );

  tool(
    'role_sum_install_skill',
    '安装 Character_Skill_Producer（csp）skill：不存在时 git clone 到 ~/.dsh/skills/csp',
    { type: 'object', properties: {}, additionalProperties: false },
    async () => JSON.stringify(await installSkill(), null, 2),
  );

  tool(
    'role_sum_list',
    '列出已经生成的角色人格文档目录（<输出目录>/<slug>/SKILL.md）',
    { type: 'object', properties: {}, additionalProperties: false },
    async () =>
      JSON.stringify({ root: paths().root, personaRoot: paths().personaRoot, ...library() }, null, 2),
  );

  tool(
    'role_sum_check',
    '质检一份角色人格文档是否符合角色背景与人设：检查来源、检索日期、知识边界、台词样本、可溯源性。返回分数与待修清单，改完可再查，直到 level=ok。',
    {
      type: 'object',
      properties: { slug: { type: 'string', description: '资产库里的角色文件夹名，例如 祀-明日方舟-终末地' } },
      required: ['slug'],
      additionalProperties: false,
    },
    async (args) => {
      const slug = String(args.slug || '').trim();
      if (!slug) return '缺少 slug（用 role_sum_list 看有哪些）';
      const r = check(slug);
      if (!r.ok) return r.error;
      const rep = r.report;
      const lines = [
        '质检：' + slug,
        '分数 ' + rep.score + '（' + rep.level + '），错误 ' + rep.errorCount + ' / 警告 ' + rep.warnCount,
        '目录：' + r.dir,
      ];
      if (rep.issues.length) {
        lines.push('待修：');
        for (const i of rep.issues) lines.push('- [' + i.level + '] ' + i.message + ' → ' + i.hint);
      } else {
        lines.push('全部通过，可以装进 personas/ 用了。');
      }
      return lines.join('\n');
    },
  );

  tool(
    'role_sum_library',
    '看角色资产库：每个角色一行（名字、作品、字数、资料覆盖到哪天、质检分数、版本数）。',
    { type: 'object', properties: {}, additionalProperties: false },
    async () => {
      const lib = library();
      const lines = ['资产库：' + lib.root, '共 ' + lib.items.length + ' 个角色'];
      for (const it of lib.items) {
        lines.push(
          [
            '· ' + it.slug,
            it.work ? '作品 ' + it.work : '作品未记录',
            it.chars + ' 字',
            '资料到 ' + (it.coveredUntil || '未记录'),
            it.quality ? '质检 ' + it.quality.score + '(' + it.quality.level + ')' : '未质检',
            it.versions + ' 个历史版本',
          ].join(' | '),
        );
      }
      return lines.join('\n');
    },
  );

  tool(
    'role_sum_source_add',
    '给某个角色手动挂一条资料（角色-来源）：标题 + 链接 / 备注 / 原文。原文会落进 references/manual/，质检溯源才算得上。',
    {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '角色文件夹名，例如 祀-明日方舟-终末地' },
        title: { type: 'string', description: '资料标题，例如「干员档案·祀」' },
        url: { type: 'string', description: '来源链接（可空）' },
        note: { type: 'string', description: '备注：为什么加它（可空）' },
        content: { type: 'string', description: '原文正文（可空，但贴了才有溯源码）' },
      },
      required: ['slug', 'title'],
      additionalProperties: false,
    },
    async (args) => {
      const slug = String(args.slug || '').trim();
      if (!slug) return '缺少 slug';
      if (!existsSync(dirOf(slug))) return '资产库里没有这个角色：' + slug;
      return JSON.stringify(addSource(dirOf(slug), args), null, 2);
    },
  );

  tool(
    'role_sum_source_list',
    '列出一个角色已经挂上的资料（手动加的来源 + 自动采集的原文份数）。',
    {
      type: 'object',
      properties: { slug: { type: 'string', description: '角色文件夹名' } },
      required: ['slug'],
      additionalProperties: false,
    },
    async (args) => {
      const slug = String(args.slug || '').trim();
      const dir = dirOf(slug);
      if (!existsSync(dir)) return '资产库里没有这个角色：' + slug;
      const list = listSources(dir);
      const lines = ['资料：' + slug, '手动 ' + list.length + ' 条'];
      for (const s of list) {
        lines.push('· [' + s.id + '] ' + s.title + (s.url ? ' | ' + s.url : '') + (s.chars ? ' | ' + s.chars + ' 字' : ' | 无正文'));
      }
      return lines.join('\n');
    },
  );

  tool(
    'role_sum_source_remove',
    '摘掉一个角色某条手动资料（按 id），对应的原文文件一起删。',
    {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '角色文件夹名' },
        id: { type: 'string', description: '资料 id，用 role_sum_source_list 查' },
      },
      required: ['slug', 'id'],
      additionalProperties: false,
    },
    async (args) => {
      const dir = dirOf(String(args.slug || '').trim());
      if (!existsSync(dir)) return '资产库里没有这个角色';
      return JSON.stringify(removeSource(dir, String(args.id || '').trim()), null, 2);
    },
  );

  tool(
    'role_sum_delete',
    '删掉一个角色（整个文件夹搬到 <资产库>/_trash/，不是真删）。必须显式传 confirm=true。',
    {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '角色文件夹名' },
        confirm: { type: 'boolean', description: '确认删除，必须传 true' },
      },
      required: ['slug', 'confirm'],
      additionalProperties: false,
    },
    async (args) => {
      if (args.confirm !== true) return '删除要先确认：传 confirm=true 再叫我一次';
      return JSON.stringify(deleteItem(paths().root, String(args.slug || '').trim()), null, 2);
    },
  );

  tool(
    'role_sum_persona',
    '把资产库里的资料再蒸馏成一份短人设文档（persona.md）；install=true 时把它装进 personas/ 目录给子人格用。',
    {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '角色文件夹名' },
        install: { type: 'boolean', description: 'true = 不再生成，直接把现有 persona.md 装进 personas/' },
        fileName: { type: 'string', description: '装进去的文件名，例如 07-祀.md（可空）' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    async (args) => {
      const slug = String(args.slug || '').trim();
      if (!slug) return '缺少 slug';
      if (args.install) {
        return JSON.stringify(installPersona(dirOf(slug), paths().personaRoot, args.fileName || slug + '.md'), null, 2);
      }
      return JSON.stringify(await startPersonaSession(slug, { fileName: args.fileName }), null, 2);
    },
  );

  // ---- 系统提示 ----
  try {
    const systemPrompt = ctx.get?.('systemPrompt');
    if (systemPrompt && cfg.enabled) {
      systemPrompt.context({
        name: 'role-sum-workflow',
        text:
          '需要总结二次元角色/真人的人格时，用 role_sum_research 采集资料（萌娘百科优先，其次百科/BWiki/B站/Google），' +
          '再按 csp skill 的固定工作流生成 <slug>/{SKILL.md,manifest.json,references/**}。' +
          '每个事实都标来源与检索日期，信息不足就写边界，不编。',
      });
    }
  } catch {
    /* systemPrompt 不可用就跳过 */
  }

  // ---- 设置页路由 ----
  try {
    const handle = async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const path = url.pathname.replace(/^\/api\/role-sum/, '') || '/';

      if (req.method === 'GET' && path === '/status') {
        return sendJson(res, 200, {
          ok: true,
          config: cfg,
          workspace: workspaceRoot(),
          outputRoot: outputRoot(),
          paths: paths(),
          cspDir: cspDir(),
          cspReady: cspReady(),
          outputs: listOutputs(),
          libraryCount: library().items.length,
        });
      }

      if (req.method === 'GET' && path === '/library') {
        return sendJson(res, 200, { ok: true, ...library(), agentReady: Boolean(agentService()) });
      }

      if (req.method === 'GET' && path === '/item') {
        const slug = String(url.searchParams.get('slug') || '').trim();
        const item = slug ? readItem(paths().root, slug) : null;
        if (!item) return sendJson(res, 404, { ok: false, error: '没有这个角色：' + slug });
        return sendJson(res, 200, { ok: true, ...item });
      }

      if (req.method === 'POST' && path === '/check') {
        const body = await readBody(req);
        return sendJson(res, 200, check(String(body.slug || '').trim()));
      }

      if (req.method === 'POST' && path === '/update') {
        if (!cfg.enabled) return sendJson(res, 400, { ok: false, error: '插件未启用' });
        const body = await readBody(req);
        const slug = String(body.slug || '').trim();
        if (!slug) return sendJson(res, 400, { ok: false, error: '缺少 slug' });
        const r = await startUpdateSession(slug, String(body.focus || '').trim());
        return sendJson(res, r.ok ? 200 : 400, r);
      }

      if (req.method === 'GET' && path === '/sources') {
        const slug = String(url.searchParams.get('slug') || '').trim();
        if (!slug) return sendJson(res, 400, { ok: false, error: '缺少 slug' });
        return sendJson(res, 200, { ok: true, slug, sources: listSources(dirOf(slug)) });
      }

      if (req.method === 'POST' && path === '/source') {
        const body = await readBody(req);
        const slug = String(body.slug || '').trim();
        if (!slug) return sendJson(res, 400, { ok: false, error: '缺少 slug' });
        if (!existsSync(dirOf(slug))) return sendJson(res, 404, { ok: false, error: '没有这个角色：' + slug });
        if (body.action === 'remove') return sendJson(res, 200, removeSource(dirOf(slug), String(body.id || '')));
        return sendJson(res, 200, addSource(dirOf(slug), body));
      }

      if (req.method === 'POST' && path === '/delete') {
        const body = await readBody(req);
        const slug = String(body.slug || '').trim();
        if (!slug) return sendJson(res, 400, { ok: false, error: '缺少 slug' });
        if (body.confirm !== true) return sendJson(res, 400, { ok: false, error: '删除要先确认（confirm: true）' });
        return sendJson(res, 200, deleteItem(paths().root, slug));
      }

      if (req.method === 'POST' && path === '/persona') {
        if (!cfg.enabled) return sendJson(res, 400, { ok: false, error: '插件未启用' });
        const body = await readBody(req);
        const slug = String(body.slug || '').trim();
        if (!slug) return sendJson(res, 400, { ok: false, error: '缺少 slug' });
        if (body.action === 'install') {
          const fileName = String(body.fileName || slug + '.md');
          return sendJson(res, 200, installPersona(dirOf(slug), paths().personaRoot, fileName));
        }
        const r = await startPersonaSession(slug, { fileName: body.fileName });
        return sendJson(res, r.ok ? 200 : 400, r);
      }

      if (req.method === 'POST' && path === '/config') {
        return sendJson(res, 200, { ok: true, config: saveConfig(await readBody(req)) });
      }

      if (req.method === 'POST' && path === '/install-skill') {
        return sendJson(res, 200, await installSkill());
      }

      if (req.method === 'POST' && path === '/research') {
        if (!cfg.enabled) return sendJson(res, 400, { ok: false, error: '插件未启用' });
        if (!cspReady()) return sendJson(res, 400, { ok: false, error: 'csp skill 未安装' });
        const body = await readBody(req);
        const role = String(body.role || '').trim();
        if (!role) return sendJson(res, 400, { ok: false, error: '缺少 role' });
        const out = await collect(role, String(body.work || '').trim());
        return sendJson(res, 200, { ok: true, ...out });
      }

      return sendJson(res, 404, { ok: false, error: 'not found' });
    };

    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'prefix',
          path: '/api/role-sum',
          handler: async (req, res) => {
            if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: '只接受本机同源请求' });
            try {
              await handle(req, res);
            } catch (e) {
              sendJson(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
            }
          },
        }),
      'role-sum: /api/role-sum 路由',
    );
  } catch {
    /* webServer 不可用就跳过 */
  }
}
