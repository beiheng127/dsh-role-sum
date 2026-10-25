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
  outputDir: 'role-sums',
  cspSkillPath: '~/.dsh/skills/csp',
  python: 'python',
  preferMoegirl: true,
  maxResearchChars: 20000,
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

function readBody(req) {
  return new Promise((res) => {
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
    outputDir: z.string().default('role-sums').description('输出目录（相对工作区）'),
    cspSkillPath: z.string().default('~/.dsh/skills/csp').description('csp skill 所在目录'),
    python: z.string().default('python').description('python 可执行文件'),
    preferMoegirl: z.boolean().default(true).description('优先萌娘百科'),
    maxResearchChars: z.number().default(20000).description('单次采集最多返回给模型的字符数'),
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
  const outputRoot = () => resolve(workspace(), cfg.outputDir || 'role-sums');

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
      const r = await run(py, [script('moegirl_api.py'), role, '--full'], { cwd: cspDir() });
      const j = parseJsonLoose(r.stdout) || { ok: r.ok };
      writeJson(join(rawDir, 'moegirl.json'), j);
      steps.push({ step: 'moegirl', ok: r.ok, resolved: j.resolved || j.title || '' });
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
    async () => JSON.stringify({ root: outputRoot(), items: listOutputs() }, null, 2),
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
          workspace: workspace(),
          outputRoot: outputRoot(),
          cspDir: cspDir(),
          cspReady: cspReady(),
          outputs: listOutputs(),
        });
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
