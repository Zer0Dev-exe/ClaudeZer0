import { h, clear, icon, basename } from '../dom.js';
import { highlightLine, languageOf } from '../highlight.js';
import { state, on, setPanel, refreshChanges, activeWorkspace, modelInfo } from '../store.js';
import { buildReviewCard } from './reviews.js';

// Panel derecho: cambios sin guardar (diff) y revisiones del hilo, como el panel de diff de T3 Code

const LARGE = 500;

function parsePatch(patch) {
  const rows = [];
  let a = 0, b = 0;
  for (const line of String(patch || '').split('\n')) {
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (m) { a = Number(m[1]); b = Number(m[2]); rows.push({ t: 'hunk', text: `@@ -${m[1]} +${m[2]} @@${m[3]}` }); continue; }
    if (line.startsWith('+')) rows.push({ t: 'add', n: ['', b++], text: line.slice(1) });
    else if (line.startsWith('-')) rows.push({ t: 'del', n: [a++, ''], text: line.slice(1) });
    else if (line.startsWith('\\')) continue;
    else rows.push({ t: 'ctx', n: [a++, b++], text: line.slice(1) });
  }
  return rows;
}

function fileBlock(file, openByDefault) {
  const lang = languageOf(file.path);
  const open = openByDefault;
  const block = h('div', { class: `diff-file${open ? ' open' : ''}`, dataset: { path: file.path } });
  const code = h('div', { class: 'diff-code', hidden: !open });
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    if (file.binary) { code.append(h('div', { class: 'diff-note' }, 'Archivo binario o demasiado grande para mostrarlo')); return; }
    if (file.tooLarge) { code.append(h('div', { class: 'diff-note' }, 'Diff demasiado grande para mostrarlo aquí')); return; }
    if (!file.patch) { code.append(h('div', { class: 'diff-note' }, 'Sin cambios de contenido')); return; }
    const frag = document.createDocumentFragment();
    for (const r of parsePatch(file.patch)) {
      if (r.t === 'hunk') { frag.append(h('div', { class: 'dl hunk' }, r.text)); continue; }
      frag.append(h('div', { class: `dl ${r.t}` },
        h('span', { class: 'n' }, r.n[0]), h('span', { class: 'n' }, r.n[1]), h('span', { class: 'c', html: highlightLine(r.text, lang) || ' ' })));
    }
    code.append(frag);
  };
  if (open) build();
  const head = h('button', { class: 'diff-file-head', type: 'button', onclick: () => {
    const nowOpen = !block.classList.contains('open');
    block.classList.toggle('open', nowOpen);
    code.hidden = !nowOpen;
    if (nowOpen) build();
  } },
    icon('chevron-right', 'chev'), h('span', { class: `fstatus ${file.status}` }, file.status === 'A' ? '+' : file.status === 'D' ? '−' : file.status === 'R' ? 'R' : '•'),
    h('span', { class: 'path', title: file.path }, h('span', null, file.path)),
    h('span', { class: 'stat-add tabular' }, `+${file.additions}`), h('span', { class: 'stat-del tabular' }, `−${file.deletions}`));
  block.append(head, code);
  block.open = () => { if (!block.classList.contains('open')) head.click(); };
  return block;
}

export function createPanel() {
  const root = h('aside', { class: 'panel' });
  const resize = h('div', { class: 'panel-resize' });
  const tabs = h('div', { class: 'panel-tabs drag' });
  const sub = h('div', { class: 'panel-sub' });
  const body = h('div', { class: 'panel-body' });
  root.append(resize, tabs, sub, body);

  const saved = Number(localStorage.getItem('z0d_panel_w'));
  if (saved) root.style.width = `${saved}px`;
  resize.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resize.classList.add('dragging');
    const move = (ev) => {
      const w = Math.max(320, Math.min(window.innerWidth * 0.6, window.innerWidth - ev.clientX));
      root.style.width = `${w}px`;
    };
    const up = () => {
      resize.classList.remove('dragging');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      localStorage.setItem('z0d_panel_w', String(parseInt(root.style.width, 10)));
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  const allReviews = () => state.messages.filter(m => m.role === 'assistant').flatMap(m => (m.reviews || []).map(r => ({ r, m }))).reverse();

  function renderTabs() {
    clear(tabs);
    const revCount = allReviews().length;
    const tab = (id, ic, label, extra) => h('button', { class: `panel-tab${state.ui.panel.tab === id ? ' on' : ''}`, type: 'button', onclick: () => setPanel({ tab: id }) }, icon(ic), label, extra);
    tabs.append(tab('changes', 'file-diff', 'Cambios'), tab('reviews', 'orch', 'Revisiones', revCount ? h('span', { class: 'badge' }, revCount) : null),
      h('span', { class: 'grow' }),
      h('button', { class: 'icon-btn', type: 'button', title: 'Actualizar', onclick: refreshChanges }, icon('refresh')),
      h('button', { class: 'icon-btn', type: 'button', title: 'Cerrar panel', onclick: () => setPanel({ open: false }) }, icon('panel-right')));
  }

  function renderChanges() {
    const c = state.changes;
    clear(sub); clear(body);
    if (!activeWorkspace()) { body.append(h('div', { class: 'panel-empty' }, icon('folder'), 'Elige un proyecto para ver sus cambios.')); return; }
    if (!c || (c.loading && !c.files)) { body.append(h('div', { class: 'panel-empty' }, icon('loader', 'spin'), 'Cargando cambios…')); return; }
    if (!c.isRepo) { body.append(h('div', { class: 'panel-empty' }, icon('git-branch'), c.error ? 'No se pudieron leer los cambios.' : 'Esta carpeta no es un repositorio git: no hay diff que mostrar.')); return; }
    sub.append(h('span', { class: 'branch' }, icon('git-branch'), c.branch || '—'), h('span', { class: 'grow' }),
      h('span', { class: 'stat-add tabular' }, `+${c.additions}`), h('span', { class: 'stat-del tabular' }, `−${c.deletions}`), h('span', null, `${c.files.length} arch.`));
    if (!c.files.length) { body.append(h('div', { class: 'panel-empty' }, icon('circle-check'), 'Sin cambios sin guardar.')); return; }
    const small = c.files.length <= 12;
    for (const f of c.files) body.append(fileBlock(f, small && (f.additions + f.deletions) < LARGE));
    if (c.truncated) body.append(h('div', { class: 'diff-note' }, 'Algunos archivos son demasiado grandes y no se muestran.'));
  }

  function renderReviews() {
    clear(sub); clear(body);
    const list = allReviews();
    if (!list.length) {
      body.append(h('div', { class: 'panel-empty' }, icon('orch'), 'Aún no hay revisiones en este hilo.',
        h('span', { class: 'hint' }, 'Activa el revisor en el compositor: otro modelo revisará el código mientras el principal trabaja.')));
      return;
    }
    for (const { r, m } of list) body.append(h('div', { class: 'rv-item' }, buildReviewCard(r, { devName: modelInfo(m.model).name.replace(/^Claude\s+/, '') })));
  }

  const render = () => {
    root.hidden = !state.ui.panel.open;
    if (!state.ui.panel.open) return;
    renderTabs();
    state.ui.panel.tab === 'reviews' ? renderReviews() : renderChanges();
  };
  on('ui', render); on('changes', render); on('thread', render); on('messages', () => { if (state.ui.panel.open) { renderTabs(); if (state.ui.panel.tab === 'reviews') renderReviews(); } });
  on('msg', () => { if (state.ui.panel.open && state.ui.panel.tab === 'reviews') renderReviews(); });
  on('diff:focus', (path) => {
    requestAnimationFrame(() => {
      const el = body.querySelector(`.diff-file[data-path="${CSS.escape(path)}"]`) || [...body.querySelectorAll('.diff-file')].find(x => x.dataset.path.endsWith('/' + path));
      if (el) { el.open?.(); el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    });
  });
  render();
  return root;
}
