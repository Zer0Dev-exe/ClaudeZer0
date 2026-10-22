import { h, clear, icon, providerMark, showPopover, closePopover, menuItem, basename, toast } from '../dom.js';
import {
  state, on, emit, modelInfo, currentModelId, effortLevelsFor, effectiveEffort, setPref, sendMessage, cancelTask,
  respondPermission, activeWorkspace, projectList, newThread, setPanel, saveOrchestration
} from '../store.js';
import { openOrchestrator, openFolderPicker } from './dialogs.js';

const MODES = [
  { id: 'plan', label: 'Plan', desc: 'Analiza y propone, sin tocar nada', icon: 'list' },
  { id: 'manual', label: 'Supervisado', desc: 'Te pide permiso antes de cada acción', icon: 'shield' },
  { id: 'acceptEdits', label: 'Aceptar ediciones', desc: 'Edita solo; pide permiso para comandos', icon: 'pencil' },
  { id: 'auto', label: 'Autónomo', desc: 'De principio a fin, sin pedir confirmación', icon: 'zap' }
];
const EFFORT_LABEL = { auto: 'Auto', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo' };
const PROVIDER_LABEL = { claude: 'Claude', codex: 'ChatGPT', gemini: 'Gemini' };

export const allowedModes = () => {
  const u = state.user;
  if (!u || u.role === 'admin') return MODES;
  return MODES.filter(m => (u.allowedModes || []).includes(m.id));
};

const shortName = (n) => String(n || '').replace(/^Claude\s+/i, '');

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, data: String(r.result).split(',')[1] || '' });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function createComposer() {
  const wrap = h('div', { class: 'composer-wrap' });
  const dock = h('div', { class: 'dock' });
  const strip = h('div', { class: 'attach-strip', hidden: true });
  const input = h('textarea', { rows: 1, placeholder: 'Pide cambios, haz una pregunta o adjunta imágenes', 'aria-label': 'Mensaje' });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true });
  const footer = h('div', { class: 'composer-foot' });
  const meta = h('div', { class: 'composer-meta' });
  const box = h('div', { class: 'composer' }, strip, input, footer);
  wrap.append(h('div', { class: 'composer-col' }, dock, box, meta, fileInput));

  let attachments = [];
  const draftKey = () => state.activeId || 'new';

  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 260)}px`;
  };

  // ------------------------------------------------------------ adjuntos
  const renderAttachments = () => {
    clear(strip);
    strip.hidden = !attachments.length;
    attachments.forEach((a, i) => strip.append(h('span', { class: 'chip' }, icon('paperclip'), a.name,
      h('button', { type: 'button', 'aria-label': 'Quitar', onclick: () => { attachments.splice(i, 1); renderAttachments(); } }, icon('x')))));
  };
  const addFiles = (files) => {
    for (const f of files) {
      if (attachments.length >= 10) { toast('Máximo 10 archivos por mensaje', 'error'); break; }
      if (f.size > 15 * 1024 * 1024) { toast(`«${f.name}» supera los 15 MB`, 'error'); continue; }
      attachments.push({ name: f.name || 'imagen.png', file: f });
    }
    renderAttachments();
  };
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag-over'); });
  box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('drag-over'); addFiles([...e.dataTransfer.files]); });

  // ------------------------------------------------------------ envío
  const send = async () => {
    if (state.running) return;
    const text = input.value;
    if (!text.trim() && !attachments.length) return;
    let encoded = [];
    try { encoded = await Promise.all(attachments.map(a => readFile(a.file))); } catch { toast('No se pudieron leer los archivos', 'error'); return; }
    if (sendMessage(text, encoded)) {
      input.value = '';
      state.drafts.delete(draftKey());
      attachments = [];
      renderAttachments();
      autosize();
    }
  };
  input.addEventListener('input', () => { autosize(); state.drafts.set(draftKey(), input.value); renderFooter(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });

  // ------------------------------------------------------------ menús
  const modelMenu = (anchor) => {
    const search = h('input', { class: 'menu-search', placeholder: 'Buscar modelo…', type: 'text' });
    const body = h('div');
    const draw = () => {
      clear(body);
      const q = search.value.trim().toLowerCase();
      for (const provider of ['claude', 'codex', 'gemini']) {
        const models = state.models.filter(m => (m.provider || 'claude') === provider && (!q || (m.name + m.id).toLowerCase().includes(q)));
        if (!models.length) continue;
        const connected = provider === 'claude' || state.providers[provider]?.loggedIn;
        body.append(h('div', { class: 'menu-head' }, PROVIDER_LABEL[provider] + (connected ? '' : ' · sin conectar')));
        for (const m of models.slice(0, 14)) {
          body.append(h('button', { class: `menu-item${m.id === currentModelId() ? ' selected' : ''}`, type: 'button', disabled: !connected,
            onclick: () => { setPref('model', m.id); closePopover(); } },
            providerMark(provider), h('span', { class: 'menu-label' }, shortName(m.name)), m.tag && provider === 'claude' ? h('span', { class: 'menu-hint' }, m.tag) : null,
            m.id === currentModelId() ? icon('check', 'menu-check') : null));
        }
      }
      const levels = effortLevelsFor(currentModelId());
      if (levels.length && !q) {
        body.append(h('div', { class: 'menu-sep' }), h('div', { class: 'menu-head' }, 'Esfuerzo'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '2px 8px 8px' } },
            ['auto', ...levels].map(l => h('button', { class: `btn-sm${(state.prefs.effort === l || (l === 'auto' && !levels.includes(state.prefs.effort))) ? ' btn-primary' : ''}`, type: 'button',
              onclick: () => { setPref('effort', l); draw(); } }, EFFORT_LABEL[l] || l))));
      }
    };
    search.addEventListener('input', draw);
    draw();
    const pop = showPopover(anchor, h('div', null, search, body), { side: 'top', className: 'wide' });
    search.focus();
    return pop;
  };

  const modeMenu = (anchor) => showPopover(anchor, h('div', null,
    allowedModes().map(m => h('button', { class: `menu-item${m.id === state.prefs.mode ? ' selected' : ''}`, type: 'button', onclick: () => { setPref('mode', m.id); closePopover(); } },
      icon(m.icon), h('span', { style: { flex: 1, display: 'flex', flexDirection: 'column' } }, h('span', null, m.label), h('span', { class: 'menu-hint' }, m.desc)),
      m.id === state.prefs.mode ? icon('check', 'menu-check') : null))), { side: 'top', className: 'wide' });

  const reviewerMenu = (anchor) => {
    const cfg = state.orch?.config;
    const rev = state.orch?.reviewer;
    const toggle = h('label', { class: 'switch', style: { padding: '8px 10px' } },
      h('input', { type: 'checkbox', checked: !!cfg?.enabled, onchange: async (e) => { await saveOrchestration({ enabled: e.target.checked }); closePopover(); } }),
      h('span', { class: 'track' }), h('span', { class: 'text' }, h('b', { style: { fontWeight: 500 } }, 'Revisión automática'),
        h('small', null, rev ? `Revisa ${shortName(rev.name)}` : 'No hay ningún modelo disponible para revisar')));
    showPopover(anchor, h('div', null, toggle, h('div', { class: 'menu-sep' }),
      menuItem({ label: 'Ajustes del orquestador…', icon: 'settings', onClick: () => { closePopover(); openOrchestrator(); } })), { side: 'top', className: 'wide' });
  };

  const projectMenu = (anchor) => showPopover(anchor, h('div', null,
    h('div', { class: 'menu-head' }, 'Proyecto'),
    projectList().map(p => menuItem({ label: p.name, hint: p.dir.length > 30 ? '…' + p.dir.slice(-28) : p.dir, selected: p.dir === activeWorkspace(), onClick: () => { closePopover(); newThread({ workspace: p.dir }); } })),
    h('div', { class: 'menu-sep' }),
    menuItem({ label: 'Añadir proyecto…', icon: 'folder-plus', onClick: () => { closePopover(); openFolderPicker(); } })), { side: 'top', className: 'wide' });

  // ------------------------------------------------------------ pintado
  function renderFooter() {
    clear(footer);
    const model = modelInfo(currentModelId());
    const levels = effortLevelsFor(model.id);
    const eff = effectiveEffort();
    const modelBtn = h('button', { class: 'chip-btn', type: 'button', title: 'Modelo y esfuerzo', onclick: () => modelMenu(modelBtn) },
      providerMark(model.provider || 'claude'), h('span', null, shortName(model.name)), levels.length ? h('span', { class: 'sub' }, EFFORT_LABEL[eff || 'auto']) : null, icon('chevron-down', 'chev'));
    const mode = MODES.find(m => m.id === state.prefs.mode) || MODES[3];
    const modeBtn = h('button', { class: 'chip-btn', type: 'button', title: 'Modo de ejecución', onclick: () => modeMenu(modeBtn) }, icon(mode.icon), mode.label, icon('chevron-down', 'chev'));
    const rev = state.orch?.config?.enabled ? state.orch.reviewer : null;
    const revBtn = h('button', { class: `chip-btn${rev ? '' : ''}`, type: 'button', title: 'Orquestador: otro modelo revisa el código',
      style: rev ? { color: 'var(--info-fg)' } : null, onclick: () => reviewerMenu(revBtn) },
      icon('orch'), rev ? `Revisa ${shortName(rev.name)}` : 'Sin revisor');
    const attachBtn = h('button', { class: 'icon-btn', type: 'button', title: 'Adjuntar archivos o imágenes', onclick: () => fileInput.click() }, icon('paperclip'));
    const canSend = !!input.value.trim() || attachments.length > 0;
    const sendBtn = state.running
      ? h('button', { class: 'send-btn stop', type: 'button', title: 'Detener', onclick: cancelTask }, h('span', { class: 'ic' }, h('span', { style: { width: '12px', height: '12px', background: 'currentColor', borderRadius: '2px', display: 'block', margin: 'auto' } })))
      : h('button', { class: 'send-btn', type: 'button', title: 'Enviar (Enter)', disabled: !canSend, onclick: send }, icon('arrow-up'));
    footer.append(modelBtn, modeBtn, revBtn, h('span', { class: 'grow' }), attachBtn, sendBtn);
  }

  function renderMeta() {
    clear(meta);
    const dir = activeWorkspace();
    const draft = !state.activeId;
    const projBtn = h('button', { class: 'chip-btn', type: 'button', title: dir, disabled: !draft && false, onclick: () => draft ? projectMenu(projBtn) : null },
      icon('folder'), basename(dir) || 'Elige un proyecto', draft ? icon('chevron-down', 'chev') : null);
    const git = state.gitSummary[dir];
    meta.append(projBtn);
    if (git?.isRepo) {
      meta.append(h('span', { class: 'chip-btn', style: { cursor: 'default' } }, icon('git-branch'), git.branch));
      if (git.changedFiles) meta.append(h('button', { class: 'chip-btn', type: 'button', title: 'Ver cambios sin guardar', onclick: () => setPanel({ open: true, tab: 'changes' }) },
        h('span', { class: 'stat-add tabular' }, `+${git.additions}`), h('span', { class: 'stat-del tabular' }, `−${git.deletions}`), `· ${git.changedFiles} arch.`));
    }
    meta.append(h('span', { class: 'grow' }));
    if (state.running) {
      const model = modelInfo(state.messages.at(-1)?.model || currentModelId());
      meta.append(h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', paddingRight: '8px' } }, icon('loader', 'spin'),
        state.phase === 'reviewing' ? `Revisando · ${shortName(state.orch?.reviewer?.name || 'revisor')}` : `${shortName(model.name)} trabajando`));
    }
  }

  function renderDock() {
    clear(dock);
    const mine = [...state.perms.values()].filter(p => !state.activeId || p.sessionId === state.activeId);
    for (const req of mine.slice(0, 3)) {
      const detail = req.input?.command || req.input?.file_path || req.input?.path || req.input?.url || JSON.stringify(req.input || {}, null, 2);
      dock.append(h('div', { class: 'perm' },
        h('div', { class: 'perm-head' }, icon('shield'), `Zer0 quiere usar ${req.tool}`),
        h('pre', null, String(detail).slice(0, 1200)),
        h('div', { class: 'perm-actions' },
          h('button', { class: 'btn-sm btn-primary', type: 'button', onclick: () => respondPermission(req.id, true) }, 'Permitir'),
          h('button', { class: 'btn-sm', type: 'button', onclick: () => respondPermission(req.id, true, true) }, 'Permitir siempre'),
          h('button', { class: 'btn-sm btn-danger', type: 'button', onclick: () => respondPermission(req.id, false) }, 'Denegar'))));
    }
  }

  const syncDraft = () => { input.value = state.drafts.get(draftKey()) || ''; autosize(); };
  const all = () => { renderFooter(); renderMeta(); renderDock(); };
  for (const ev of ['prefs', 'composer', 'orch', 'running', 'git', 'status']) on(ev, all);
  on('perms', renderDock);
  on('thread', () => { syncDraft(); all(); });
  all();

  return { el: wrap, focus: () => input.focus(), setText: (t) => { input.value = t; autosize(); renderFooter(); } };
}
