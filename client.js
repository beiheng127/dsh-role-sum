/**
 * dsh-role-sum —— 设置页（浏览器半端）
 *
 * 按 DSH 约定自注册：window.__ModuleLoader__.load({ id, factory })
 * 进「设置」靠 slots.inject('settings.section', ...)。
 */
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
[data-rs]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 8px;max-width:640px;}
[data-rs-sec]{display:flex;flex-direction:column;gap:8px;}
[data-rs-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-rs-label]{font-size:13px;}
[data-rs-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-rs-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));color:inherit;}
[data-rs-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-rs-sw][data-on]{background:#3b82f6;}
[data-rs-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;display:block;}
[data-rs-sw][data-on] i{left:19px;}
[data-rs-btn]{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));color:inherit;font-size:12px;cursor:pointer;}
[data-rs-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-rs-ok]{font-size:11px;color:#22c55e;}
[data-rs-err]{font-size:11px;color:#ef4444;}
[data-rs-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-rs-list]{display:flex;flex-direction:column;gap:4px;font-size:11px;}
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
      const [form, setForm] = React.useState({});
      const [msg, setMsg] = React.useState('');
      const [err, setErr] = React.useState('');

      const load = async () => {
        try {
          const j = await jget('/status');
          setSt(j);
          setForm(j.config || {});
        } catch (e) {
          setErr(String(e.message || e));
        }
      };

      React.useEffect(() => {
        load();
      }, []);

      const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

      const save = async () => {
        setErr('');
        try {
          await jpost('/config', form);
          setMsg('已保存');
          await load();
        } catch (e) {
          setErr(String(e.message || e));
        }
      };

      const install = async () => {
        setErr('');
        setMsg('安装中…');
        try {
          const r = await jpost('/install-skill');
          setMsg(r.ok ? r.message || '安装完成' : '安装失败：' + (r.error || ''));
          await load();
        } catch (e) {
          setErr(String(e.message || e));
        }
      };

      if (!st) {
        return h('div', { 'data-rs': '' }, h('div', { 'data-rs-note': '' }, err || '读取中…'));
      }

      return h(
        'div',
        { 'data-rs': '' },
        h(
          'div',
          { 'data-rs-row': '' },
          h('div', { 'data-rs-label': '' }, '角色总结'),
          h('button', {
            'data-rs-sw': '',
            'data-on': form.enabled ? '' : undefined,
            onClick: () => set('enabled', !form.enabled),
          }, h('i')),
          h('span', { 'data-rs-note': '' }, form.enabled ? '已启用' : '已关闭'),
        ),

        h(Field, { label: '输出目录（相对工作区）' },
          h('input', {
            'data-rs-input': '',
            value: form.outputDir || '',
            onChange: (e) => set('outputDir', e.target.value),
          })),
        h(Field, { label: 'csp skill 目录' },
          h('input', {
            'data-rs-input': '',
            value: form.cspSkillPath || '',
            onChange: (e) => set('cspSkillPath', e.target.value),
          })),
        h(Field, { label: 'python 路径' },
          h('input', {
            'data-rs-input': '',
            value: form.python || '',
            onChange: (e) => set('python', e.target.value),
          })),

        h('div', { 'data-rs-note': '' },
          '工作区：' + st.workspace,
          ' · 输出：' + st.outputRoot,
          ' · csp：' + (st.cspReady ? '已安装' : '未安装')),

        h('div', { 'data-rs-row': '' },
          h('button', { 'data-rs-btn': '', 'data-primary': '', onClick: save }, '保存'),
          h('button', { 'data-rs-btn': '', onClick: install }, '安装 Skill'),
          h('button', { 'data-rs-btn': '', onClick: load }, '刷新'),
          msg ? h('span', { 'data-rs-ok': '' }, msg) : null,
          err ? h('span', { 'data-rs-err': '' }, err) : null),

        h('div', { 'data-rs-sec': '' },
          h('div', { 'data-rs-h': '' }, '已生成'),
          h('div', { 'data-rs-list': '' },
            (st.outputs || []).length
              ? (st.outputs || []).map((o) =>
                  h('div', { key: o.slug, 'data-rs-note': '' }, o.slug + (o.hasSkill ? ' · SKILL.md' : ' · 未完成')))
              : h('div', { 'data-rs-note': '' }, '还没有生成过')),
      ),
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
          slots.register({ name: 'settings.section', id: 'role-sum', order: 36, label: '角色总结' }, () =>
            h(Panel),
          ),
        );
      },
    };
  },
});
