import { h, clear, icon, monogram, basename, showPopover, closePopover, menuItem, providerMark } from '../dom.js';
import { state, on, setUi, setPanel, activeWorkspace, newThread, deleteSession, modelInfo } from '../store.js';
import { createTimeline } from './timeline.js';
import { createComposer } from './composer.js';
import { createPanel } from './panel.js';
import { openOrchestrator } from './dialogs.js';

const short = (n) => String(n || '').replace(/^Claude\s+/i, '');

export function mountWorkspace(root) {
  const topbar = h('header', { class: 'topbar drag' });
  const chatCol = h('div', { class: 'chat-col' });
  const timeline = createTimeline();
  const composer = createComposer();
  const panel = createPanel();
  root.append(topbar, h('div', { class: 'main-col' }, chatCol, panel));

  const hero = h('div', { class: 'hero' });

  function renderTopbar() {
    clear(topbar);
    const dir = activeWorkspace();
    const proj = basename(dir);
    const title = state.session?.title || (state.activeId ? 'Conversación' : 'Nuevo hilo');
    const crumbs = h('div', { class: 'crumbs' },
      proj ? [h('button', { class: 'crumb-proj no-drag', type: 'button', title: `Nuevo hilo en ${proj}`, onclick: () => newThread({ workspace: dir }) }, monogram(proj), h('span', { class: 'truncate' }, proj)), h('span', { class: 'crumb-sep' }, '/')] : null,
      h('button', { class: 'crumb-title truncate no-drag', type: 'button', onclick: state.activeId ? (e) => threadMenu(e.currentTarget) : null }, title,
        state.activeId ? icon('chevron-down') : null));

    const rev = state.orch?.config?.enabled ? state.orch.reviewer : null;
    const dev = modelInfo(state.messages.filter(m => m.role === 'assistant').at(-1)?.model || state.prefs.model || state.defaultModel);
    const orchPill = h('button', { class: `pill-btn no-drag${rev ? ' on' : ''}`, type: 'button', title: 'Orquestador de agentes', onclick: openOrchestrator },
      icon('orch'), rev ? [providerMark(dev.provider || 'claude'), short(dev.name), h('span', { class: 'arrow' }, '→'), providerMark(rev.provider), short(rev.name)] : 'Sin revisor');

    const git = state.gitSummary[dir];
    const diffBtn = h('button', { class: `pill-btn no-drag${state.ui.panel.open ? ' on' : ''}`, type: 'button', title: 'Cambios sin guardar (Ctrl D)', onclick: () => setPanel({ open: !state.ui.panel.open }) },
      icon('file-diff'), git?.isRepo && git.changedFiles ? [h('span', { class: 'stat-add tabular' }, `+${git.additions}`), h('span', { class: 'stat-del tabular' }, `−${git.deletions}`)] : 'Cambios');

    // Linux: la ventana no tiene marco, así que los botones de ventana los pinta la app (redondos, como en T3 Code)
    const winctl = window.Zer0CodeDesktop?.platform === 'linux' ? h('div', { class: 'winctl no-drag' },
      h('button', { type: 'button', title: 'Minimizar', onclick: () => window.Zer0CodeDesktop.windowControl('minimize') }, icon('minus')),
      h('button', { type: 'button', title: 'Maximizar', onclick: () => window.Zer0CodeDesktop.windowControl('maximize') }, icon('square')),
      h('button', { type: 'button', class: 'close', title: 'Cerrar', onclick: () => window.Zer0CodeDesktop.windowControl('close') }, icon('x'))) : null;

    topbar.append(
      h('button', { class: 'icon-btn toggle-sidebar no-drag', type: 'button', title: 'Mostrar barra lateral (Ctrl B)', onclick: () => setUi({ sidebar: true }) }, icon('panel-left')),
      crumbs, h('div', { class: 'topbar-actions' }, orchPill, diffBtn,
        h('button', { class: `icon-btn no-drag${state.ui.panel.open ? ' active' : ''}`, type: 'button', title: 'Panel lateral', onclick: () => setPanel({ open: !state.ui.panel.open }) }, icon('panel-right'))),
      ...(winctl ? [winctl] : []));
  }

  function threadMenu(anchor) {
    showPopover(anchor, h('div', null,
      menuItem({ label: 'Copiar identificador', icon: 'copy', onClick: () => { navigator.clipboard?.writeText(state.activeId); closePopover(); } }),
      menuItem({ label: 'Eliminar conversación', icon: 'trash', danger: true, onClick: () => { closePopover(); if (confirm('¿Eliminar esta conversación?')) deleteSession(state.activeId); } })));
  }

  function renderChat() {
    const draft = !state.activeId && !state.messages.length;
    clear(chatCol);
    if (draft) {
      const proj = basename(activeWorkspace());
      clear(hero);
      hero.append(
        h('h1', null, proj ? `¿Qué construimos en ${proj}?` : '¿Qué construimos hoy?'),
        h('p', null, state.orch?.config?.enabled && state.orch.reviewer ? `${short(modelInfo(state.prefs.model || state.defaultModel).name)} desarrolla y ${short(state.orch.reviewer.name)} revisa.` : 'Elige un proyecto y pide lo que necesites.'),
        h('div', { style: { width: '100%' } }, composer.el));
      chatCol.append(hero);
    } else {
      chatCol.append(timeline, composer.el);
    }
    requestAnimationFrame(() => composer.focus());
  }

  let wasDraft = null;
  const refresh = () => {
    const draft = !state.activeId && !state.messages.length;
    if (draft !== wasDraft) { wasDraft = draft; renderChat(); }
  };
  on('thread', () => { renderTopbar(); refresh(); });
  on('messages', () => { renderTopbar(); refresh(); });
  on('ui', renderTopbar); on('orch', () => { renderTopbar(); if (wasDraft) { wasDraft = null; refresh(); } });
  on('git', renderTopbar); on('prefs', renderTopbar); on('sessions', renderTopbar); on('composer', renderTopbar);
  renderTopbar();
  refresh();
}
