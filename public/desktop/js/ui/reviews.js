import { h, icon, providerMark } from '../dom.js';
import { renderMarkdown } from '../markdown.js';
import { state, sendMessage, modelInfo, emit } from '../store.js';

// Tarjeta de revisión de otro agente (como los comentarios de «otro agente» de T3 Code)

const EFFORT = { low: 'bajo', medium: 'medio', high: 'alto', xhigh: 'muy alto', max: 'máximo' };
const sentKey = 'z0d_rv_sent';
const sent = new Set(JSON.parse(localStorage.getItem(sentKey) || '[]'));

export function reviewStatus(r) {
  if (r.status === 'running') return ['running', 'Revisando…'];
  if (r.status === 'canceled') return ['', 'Cancelada'];
  if (r.status === 'error') return ['error', 'No pudo terminar'];
  if (r.verdict === 'OK') return ['ok', 'Todo bien'];
  if (r.verdict === 'CAMBIOS') return ['warn', 'Propone cambios'];
  return ['', 'Revisada'];
}

function bodyHtml(r) {
  const text = String(r.text || '').replace(/^\s*[*`]*VEREDICTO[*`]*\s*:.*$/gim, '').trim();
  const err = r.status === 'error' ? `<div class="error-line">${escapeText(r.error || 'El revisor no pudo terminar')}</div>` : '';
  if (!text) return err || `<div class="review-wait">${r.status === 'running' ? 'El revisor está leyendo los cambios…' : 'Sin comentarios.'}</div>`;
  return err + renderMarkdown(text);
}

const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function fixPrompt(review) {
  return [
    `El revisor (${review.name || review.model}) ha revisado tus cambios y propone esto:`, '',
    String(review.text || '').replace(/^\s*[*`]*VEREDICTO[*`]*\s*:.*$/gim, '').trim(), '',
    'Corrige lo que sea correcto (🔴 y 🟠 primero). Si algún punto no es un problema real, no lo cambies y explica en una frase por qué.',
    'Al terminar, resume qué has arreglado y qué has descartado.'
  ].join('\n');
}

/** Crea o actualiza la tarjeta de `review`. `card` es un elemento previo para reutilizar (conserva si está abierta). */
export function buildReviewCard(review, { card = null, devName = 'el desarrollador' } = {}) {
  const [cls, label] = reviewStatus(review);
  const prevOpen = card ? card.classList.contains('open') : null;
  const touched = card?.dataset.touched === '1';
  const open = touched ? prevOpen : (review.status === 'running' || review.verdict === 'CAMBIOS' || review.status === 'error');
  const el = card || h('div', { class: 'review' });
  el.className = `review ${cls}${open ? ' open' : ''}`;
  el.dataset.id = review.id;

  const provider = review.provider || modelInfo(review.model).provider || 'codex';
  const kind = review.kind === 'final' ? 'Revisión final' : 'Revisión en vivo';
  const effort = review.effort ? ` · ${EFFORT[review.effort] || review.effort}` : '';
  const head = h('button', { class: 'review-head', type: 'button', onclick: () => {
    el.dataset.touched = '1';
    el.classList.toggle('open');
    body.hidden = !el.classList.contains('open');
    actions.hidden = body.hidden;
  } },
    providerMark(provider), h('span', { class: 'title truncate' }, `${kind} · ${review.name || review.model}${effort}`),
    h('span', { class: `badge ${cls}` }, label), icon('chevron-down', 'chev'));
  const body = h('div', { class: 'review-body', hidden: !open }, h('div', { class: 'md', html: bodyHtml(review) }));
  if (review.status === 'running' && review.toolCount) body.append(h('div', { class: 'review-wait' }, `${review.toolCount} comprobaciones hechas`));

  const actions = h('div', { class: 'review-actions', hidden: !open });
  if (review.status === 'done' && review.verdict === 'CAMBIOS') {
    if (sent.has(review.id)) actions.append(h('span', { class: 'cost' }, `Enviada a ${devName}`));
    else actions.append(
      h('button', { class: 'btn-sm btn-primary', type: 'button', disabled: state.running, onclick: (e) => {
        if (!sendMessage(fixPrompt(review))) return;
        sent.add(review.id);
        localStorage.setItem(sentKey, JSON.stringify([...sent].slice(-200)));
        e.currentTarget.replaceWith(h('span', { class: 'cost' }, `Enviada a ${devName}`));
      } }, icon('arrow-up'), `Enviar a ${devName}`),
      h('button', { class: 'btn-sm', type: 'button', onclick: () => { sent.add(review.id); localStorage.setItem(sentKey, JSON.stringify([...sent].slice(-200))); emit('messages'); } }, 'Descartar'));
  }
  el.replaceChildren(head, body, actions);
  return el;
}
