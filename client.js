/**
 * dsh-role-sum —— 设置页（浏览器半端）
 *
 * 按 DSH 约定自注册：window.__ModuleLoader__.load({ id, factory })
 * 进「设置」靠 slots.inject('settings.section', ...)。
 */
// 兜底：任何注册期异常都只吞掉本插件，不能连累整条 client bundle
// （DSH 把所有插件的 client.js 拼成一个 bundle，一个模块顶层抛错会拖垮全部）。
function registerRoleSum() {
  if (typeof window === 'undefined' || !window.__ModuleLoader__ || typeof window.__ModuleLoader__.load !== 'function') {
    console.warn('[dsh-role-sum] __ModuleLoader__ 不可用，跳过设置页注册');
    return;
  }
  window.__ModuleLoader__.load({
    id: 'dsh-role-sum',
    factory: (require) => {
      const React = require('react');
      const h = React.createElement;
      const API = '/api/role-sum';

      const asJson = async (res) => {
        if (res.ok) return res.json();
        const why = res.status === 401 ? '（未登录）' : res.status === 403 ? '（被拦）' : '';
        throw new Error('HTTP ' + res.status + why);
      };
      const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }));
      const jpost = async (p, body) =>
        asJson(
          await fetch(API + p, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
          }),
        );

      const CSS = `
[data-rs]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 8px;max-width:760px;}
[data-rs-sec]{display:flex;flex-direction:column;gap:8px;}
[data-rs-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-rs-label]{font-size:13px;}
[data-rs-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);word-break:break-all;}
[data-rs-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));color:inherit;font-family:inherit;}
[data-rs-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-rs-sw][data-on]{background:#3b82f6;}
[data-rs-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;display:block;}
[data-rs-sw][data-on] i{left:19px;}
[data-rs-btn]{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));color:inherit;font-size:12px;cursor:pointer;}
[data-rs-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-rs-btn][data-danger]{border-color:rgba(239,68,68,.5);color:#ef4444;}
[data-rs-btn][disabled]{opacity:.5;cursor:default;}
[data-rs-btn][data-sm]{padding:3px 9px;font-size:11px;border-radius:6px;}
[data-rs-ok]{font-size:11px;color:#22c55e;}
[data-rs-err]{font-size:11px;color:#ef4444;}
[data-rs-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-rs-list]{display:flex;flex-direction:column;gap:6px;font-size:11px;}
[data-rs-item]{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.10));
  background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));}
[data-rs-pre]{max-height:280px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:11px;
  line-height:17px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));}
[data-rs-badge]{display:inline-block;padding:1px 7px;border-radius:6px;font-size:10px;}
[data-rs-badge][data-lv=ok]{background:rgba(34,197,94,.16);color:#22c55e;}
[data-rs-badge][data-lv=warn]{background:rgba(234,179,8,.16);color:#eab308;}
[data-rs-badge][data-lv=fail]{background:rgba(239,68,68,.16);color:#ef4444;}
[data-rs-badge][data-lv=none]{background:rgba(148,163,184,.16);color:#94a3b8;}
[data-rs-grid2]{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
`;

      function Field({ label, note, children }) {
        return h(
          'div',
          { 'data-rs-sec': '' },
          h('div', { 'data-rs-label': '' }, label),
          note ? h('div', { 'data-rs-note': '' }, note) : null,
          children,
        );
      }

      function Panel() {
        const [st, setSt] = React.useState(null);
        const [lib, setLib] = React.useState({ items: [] });
        const [form, setForm] = React.useState({});
        const [msg, setMsg] = React.useState('');
        const [err, setErr] = React.useState('');
        const [open, setOpen] = React.useState(null);
        const [item, setItem] = React.useState(null);
        const [busy, setBusy] = React.useState('');
        const [delArm, setDelArm] = React.useState('');
        const [src, setSrc] = React.useState({ title: '', url: '', note: '', content: '' });
        const [nr, setNr] = React.useState({ role: '', work: '' });

        const load = async () => {
          try {
            const j = await jget('/status');
            setSt(j);
            setForm(j.config || {});
            setLib(await jget('/library'));
          } catch (e) {
            setErr(String(e.message || e));
          }
        };

        React.useEffect(() => {
          load();
        }, []);

        const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
        const setS = (k, v) => setSrc((s) => ({ ...s, [k]: v }));
        const setN = (k, v) => setNr((s) => ({ ...s, [k]: v }));

        const run = async (tag, fn) => {
          setErr('');
          setMsg('');
          setBusy(tag);
          try {
            await fn();
          } catch (e) {
            setErr(String(e.message || e));
          } finally {
            setBusy('');
          }
        };

        const save = () =>
          run('save', async () => {
            await jpost('/config', form);
            setMsg('已保存');
            await load();
          });

        const install = () =>
          run('install', async () => {
            setMsg('安装中…');
            const r = await jpost('/install-skill');
            setMsg(r.ok ? r.message || '安装完成' : '安装失败：' + (r.error || ''));
            await load();
          });

        const newRole = (research) =>
          run('new:' + (research ? 'r' : 'e'), async () => {
            const role = String(nr.role || '').trim();
            const work = String(nr.work || '').trim();
            if (!role) throw new Error('先写角色名');
            setMsg(research ? '建档中，正在采集资料，可能要几十秒…' : '建档中…');
            const r = await jpost('/create', { role, work, research });
            if (!r.ok) throw new Error(r.error || '建档失败');
            const steps = r.research && Array.isArray(r.research.steps) ? r.research.steps : [];
            const detail = steps
              .map((s) => s.step + (s.ok ? '✓' : '✗') + (s.chars ? '(' + s.chars + '字)' : ''))
              .join(' ');
            setMsg(
              '已建 ' + r.slug +
                (r.research && r.research.ok ? '，采集：' + (detail || '完成') : '') +
                (r.research && !r.research.ok ? '，' + (r.research.error || '没采集到') : ''),
            );
            setNr({ role: '', work: '' });
            await load();
            setOpen(r.slug);
            setItem(await jget('/item?slug=' + encodeURIComponent(r.slug)));
          });

        const openItem = (slug) =>
          run('open:' + slug, async () => {
            if (open === slug) {
              setOpen(null);
              setItem(null);
              return;
            }
            setOpen(slug);
            setItem(await jget('/item?slug=' + encodeURIComponent(slug)));
            setSrc({ title: '', url: '', note: '', content: '' });
          });

        const reloadItem = async (slug) => {
          if (open === slug) setItem(await jget('/item?slug=' + encodeURIComponent(slug)));
        };

        const checkItem = (slug) =>
          run('check:' + slug, async () => {
            const r = await jpost('/check', { slug });
            if (!r.ok) throw new Error(r.error || '质检失败');
            setMsg(slug + ' 质检：' + r.report.score + ' 分（' + r.report.level + '）');
            await load();
            await reloadItem(slug);
          });

        const updateItem = (slug) =>
          run('update:' + slug, async () => {
            const r = await jpost('/update', { slug });
            if (!r.ok) throw new Error(r.error || '更新失败');
            setMsg('已开会话 ' + r.sessionId + '，旧版存在 ' + r.snapshot);
            await load();
          });

        const addSource = (slug) =>
          run('srcadd:' + slug, async () => {
            if (!src.title.trim()) throw new Error('先写个资料标题');
            const r = await jpost('/source', { slug, ...src });
            if (!r.ok) throw new Error(r.error || '没加上');
            setMsg('已加资料：' + r.source.title);
            setSrc({ title: '', url: '', note: '', content: '' });
            await reloadItem(slug);
            await load();
          });

        const delSource = (slug, id) =>
          run('srcdel:' + slug, async () => {
            const r = await jpost('/source', { action: 'remove', slug, id });
            if (!r.ok) throw new Error(r.error || '没删掉');
            setMsg('已摘掉：' + (r.removed && r.removed.title ? r.removed.title : id));
            await reloadItem(slug);
            await load();
          });

        const genPersona = (slug) =>
          run('persona:' + slug, async () => {
            const r = await jpost('/persona', { slug });
            if (!r.ok) throw new Error(r.error || '开不了会话');
            setMsg('已开会话 ' + r.sessionId + ' 去蒸馏人设，写完点「装进 personas」');
            await load();
          });

        const installPersona = (slug) =>
          run('pinstall:' + slug, async () => {
            const r = await jpost('/persona', { action: 'install', slug });
            if (!r.ok) throw new Error(r.error || '装不上');
            setMsg('已装进 ' + r.to);
            await load();
          });

        const delRole = (slug) =>
          run('del:' + slug, async () => {
            const r = await jpost('/delete', { slug, confirm: true });
            if (!r.ok) throw new Error(r.error || '没删掉');
            setMsg('已移到回收站：' + r.to);
            setDelArm('');
            if (open === slug) {
              setOpen(null);
              setItem(null);
            }
            await load();
          });

        if (!st) return h('div', { 'data-rs': '' }, h('div', { 'data-rs-note': '' }, err || '读取中…'));

        const paths = st.paths || {};

        const libRow = (it) => {
          const isOpen = open === it.slug;
          return h(
            'div',
            { key: it.slug, 'data-rs-item': '' },
            h(
              'div',
              { 'data-rs-row': '' },
              h('span', { 'data-rs-label': '' }, it.name || it.slug),
              it.quality
                ? h('span', { 'data-rs-badge': '', 'data-lv': it.quality.level }, '质检 ' + it.quality.score)
                : h('span', { 'data-rs-badge': '', 'data-lv': 'none' }, '未质检'),
              it.hasPersona ? h('span', { 'data-rs-badge': '', 'data-lv': 'ok' }, '有人设') : null,
              h('button', { 'data-rs-btn': '', 'data-sm': '', onClick: () => openItem(it.slug) }, isOpen ? '收起' : '查看'),
              h('button', { 'data-rs-btn': '', 'data-sm': '', disabled: busy === 'check:' + it.slug, onClick: () => checkItem(it.slug) }, '质检'),
              h('button', { 'data-rs-btn': '', 'data-sm': '', 'data-primary': '', disabled: busy === 'update:' + it.slug, onClick: () => updateItem(it.slug) }, busy === 'update:' + it.slug ? '开会话…' : '更新新剧情'),
              h('button', { 'data-rs-btn': '', 'data-sm': '', disabled: busy === 'persona:' + it.slug, onClick: () => genPersona(it.slug) }, '生成人设'),
              it.hasPersona
                ? h('button', { 'data-rs-btn': '', 'data-sm': '', disabled: busy === 'pinstall:' + it.slug, onClick: () => installPersona(it.slug) }, '装进 personas')
                : null,
              delArm === it.slug
                ? h('button', { 'data-rs-btn': '', 'data-sm': '', 'data-danger': '', onClick: () => delRole(it.slug) }, '真删？')
                : h('button', { 'data-rs-btn': '', 'data-sm': '', 'data-danger': '', onClick: () => setDelArm(it.slug) }, '删除'),
            ),
            h(
              'div',
              { 'data-rs-note': '' },
              [
                it.work ? '作品 ' + it.work : '作品未记录',
                it.chars + ' 字',
                '采集 ' + it.rawCount + ' 份',
                '手动资料 ' + it.sourceCount + ' 条',
                '覆盖到 ' + (it.coveredUntil || '未记录'),
                it.versions + ' 个历史版本',
                it.hasSkill ? '' : '未完成（缺 SKILL.md）',
              ]
                .filter(Boolean)
                .join(' · '),
            ),
            isOpen && item
              ? h(
                  'div',
                  { 'data-rs-sec': '' },
                  item.report && item.report.issues && item.report.issues.length
                    ? h(
                        'div',
                        { 'data-rs-list': '' },
                        item.report.issues.map((i, n) =>
                          h('div', { key: 'is' + n, 'data-rs-note': '' }, '[' + i.level + '] ' + i.message + ' → ' + i.hint),
                        ),
                      )
                    : null,

                  h('div', { 'data-rs-h': '' }, '资料（角色-来源）'),
                  (item.sources || []).length
                    ? h(
                        'div',
                        { 'data-rs-list': '' },
                        item.sources.map((s) =>
                          h(
                            'div',
                            { key: s.id, 'data-rs-row': '' },
                            h('span', { 'data-rs-label': '' }, s.title),
                            h('span', { 'data-rs-note': '' }, [s.url, s.chars ? s.chars + ' 字' : '无正文', s.note].filter(Boolean).join(' · ')),
                            h('button', { 'data-rs-btn': '', 'data-sm': '', 'data-danger': '', onClick: () => delSource(it.slug, s.id) }, '摘掉'),
                          ),
                        ),
                      )
                    : h('div', { 'data-rs-note': '' }, '还没手动挂过资料，下面加一条'),

                  h(
                    'div',
                    { 'data-rs-grid2': '' },
                    h('input', { 'data-rs-input': '', placeholder: '资料标题，例如 干员档案·祀', value: src.title, onChange: (e) => setS('title', e.target.value) }),
                    h('input', { 'data-rs-input': '', placeholder: '来源链接（可空）', value: src.url, onChange: (e) => setS('url', e.target.value) }),
                  ),
                  h('input', { 'data-rs-input': '', placeholder: '备注：为什么加它（可空）', value: src.note, onChange: (e) => setS('note', e.target.value) }),
                  h('textarea', {
                    'data-rs-input': '',
                    rows: 4,
                    placeholder: '原文正文（贴进来才有溯源，质检会算它）',
                    value: src.content,
                    onChange: (e) => setS('content', e.target.value),
                  }),
                  h(
                    'div',
                    { 'data-rs-row': '' },
                    h('button', { 'data-rs-btn': '', 'data-sm': '', 'data-primary': '', disabled: busy === 'srcadd:' + it.slug, onClick: () => addSource(it.slug) }, busy === 'srcadd:' + it.slug ? '加中…' : '加这条资料'),
                  ),

                  h('div', { 'data-rs-h': '' }, '人设文档（给子人格用）'),
                  item.personaPreview
                    ? h('div', { 'data-rs-pre': '' }, item.personaPreview)
                    : h('div', { 'data-rs-note': '' }, '还没生成。点上面的「生成人设」，它会读全部资料写成 1500~2500 字的短人设'),

                  h('div', { 'data-rs-h': '' }, '档案（SKILL.md）'),
                  h('div', { 'data-rs-pre': '' }, item.preview || '（还没有 SKILL.md）'),
                  h('div', { 'data-rs-note': '' }, '文件：' + (item.files || []).map((f) => f.path).join(' · ')),
                  h('div', { 'data-rs-note': '' }, '目录：' + item.dir),
                )
              : null,
          );
        };

        return h(
          'div',
          { 'data-rs': '' },

          h(
            'div',
            { 'data-rs-row': '' },
            h('div', { 'data-rs-label': '' }, '角色总结'),
            h(
              'button',
              { 'data-rs-sw': '', 'data-on': form.enabled ? '' : undefined, onClick: () => set('enabled', !form.enabled) },
              h('i'),
            ),
            h('span', { 'data-rs-note': '' }, form.enabled ? '已启用' : '已关闭'),
          ),

          h('div', { 'data-rs-h': '' }, '目录'),
          h(Field, {
            label: '工作区根目录',
            note: '资产库和 personas 都相对它算。填绝对路径，例如 C:\\Users\\ruia3\\Documents\\deepseek-harness\\default-workspace；留空就用宿主给的那个（可能指到 profile 目录，不建议）',
          }, h('input', { 'data-rs-input': '', value: form.workspace || '', onChange: (e) => set('workspace', e.target.value) })),
          h(Field, { label: '资产库根目录', note: '相对工作区；每个角色一个子文件夹，删除的东西进 _trash/' },
            h('input', { 'data-rs-input': '', value: form.outputDir || '', onChange: (e) => set('outputDir', e.target.value) })),
          h(Field, { label: '人格文档目录', note: 'persona.md 装进这里，就是子人格能直接读的文件' },
            h('input', { 'data-rs-input': '', value: form.personaDir || '', onChange: (e) => set('personaDir', e.target.value) })),
          h(Field, { label: 'csp skill 目录', note: 'Character_Skill_Producer 放哪；采集脚本都在它的 scripts/ 下' },
            h('input', { 'data-rs-input': '', value: form.cspSkillPath || '', onChange: (e) => set('cspSkillPath', e.target.value) })),
          h(Field, {
            label: 'python 路径',
            note: '跑 csp 采集脚本用的解释器。填 python 就用系统 PATH 里那个；机器上装了多个版本、或 PATH 没配好时，填绝对路径，例如 C:\\Python312\\python.exe',
          }, h('input', { 'data-rs-input': '', value: form.python || '', onChange: (e) => set('python', e.target.value) })),
          h(Field, { label: '质检最多反复几轮', note: '生成/更新时 agent 按这个轮数改到过为止' },
            h('input', {
              'data-rs-input': '',
              value: String(form.qualityRounds == null ? 2 : form.qualityRounds),
              onChange: (e) => set('qualityRounds', Number(e.target.value) || 0),
            })),

          h('div', { 'data-rs-note': '' },
            '工作区：' + st.workspace,
            ' · 资产库：' + (paths.root || st.outputRoot),
            ' · personas：' + (paths.personaRoot || ''),
            ' · csp：' + (st.cspReady ? '已安装' : '未安装')),

          h('div', { 'data-rs-row': '' },
            h('button', { 'data-rs-btn': '', 'data-primary': '', disabled: busy === 'save', onClick: save }, busy === 'save' ? '保存中…' : '保存'),
            h('button', { 'data-rs-btn': '', disabled: busy === 'install', onClick: install }, '安装 Skill'),
            h('button', { 'data-rs-btn': '', onClick: load }, '刷新'),
            msg ? h('span', { 'data-rs-ok': '' }, msg) : null,
            err ? h('span', { 'data-rs-err': '' }, err) : null),

          h('div', { 'data-rs-sec': '' },
            h('div', { 'data-rs-h': '' }, '资产库（' + (lib.items || []).length + '）'),
            h('div', { 'data-rs-new': '' },
              h('div', { 'data-rs-h': '' }, '新增角色'),
              h('div', { 'data-rs-row': '' },
                h('input', {
                  'data-rs-input': '',
                  placeholder: '角色名，例如 芙宁娜',
                  value: nr.role,
                  onChange: (e) => setN('role', e.target.value),
                }),
                h('input', {
                  'data-rs-input': '',
                  placeholder: '所属作品，例如 原神（可空）',
                  value: nr.work,
                  onChange: (e) => setN('work', e.target.value),
                }),
                h('button', {
                  'data-rs-btn': '',
                  'data-primary': '',
                  disabled: busy === 'new:r' || busy === 'new:e',
                  onClick: () => newRole(true),
                }, busy === 'new:r' ? '采集资料…' : '新建并采集资料'),
                h('button', {
                  'data-rs-btn': '',
                  disabled: busy === 'new:r' || busy === 'new:e',
                  onClick: () => newRole(false),
                }, busy === 'new:e' ? '建档…' : '只建空档案')),
              h('div', { 'data-rs-note': '' },
                '建完就进下面的库。采集会跑 csp 脚本（萌百优先），要几十秒；想以后自己挂资料就选「只建空档案」')),
            (lib.items || []).length
              ? h('div', { 'data-rs-list': '' }, lib.items.map(libRow))
              : h('div', { 'data-rs-note': '' }, '还没有生成过角色，先在对话里让它采集一个')),
        );
      }

      return {
        inject: ['slots'],
        apply(ctx) {
          const style = document.createElement('style');
          style.textContent = CSS;
          document.head.appendChild(style);
          ctx.effect(() => () => style.remove(), 'role-sum: 设置页样式');

          const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots;
          if (!slots) return;
          slots.inject('settings.section', () =>
            slots.register({ name: 'settings.section', id: 'role-sum', order: 36, label: '角色总结' }, () => h(Panel)),
          );
        },
      };
    },
  });
}

try {
  registerRoleSum();
} catch (err) {
  console.warn('[dsh-role-sum] 设置页注册失败：', err && err.message ? err.message : err);
}
