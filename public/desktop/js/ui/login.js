import { h, clear, icon } from '../dom.js';
import { login, changePassword } from '../store.js';
import { skySvg } from './sky.js';

/** Pantalla de inicio de sesión (solo cuando la app no entró sola: servidor remoto o contraseña cambiada) */
export function renderLogin(root, { onDone, mustChange = false } = {}) {
  clear(root);
  const error = h('div', { class: 'status-box error', hidden: true });
  const user = h('input', { class: 'input', placeholder: 'Usuario', autocomplete: 'username', value: localStorage.getItem('zer0code_user') || '' });
  const pass = h('input', { class: 'input', type: 'password', placeholder: mustChange ? 'Contraseña actual' : 'Contraseña', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', placeholder: 'Nueva contraseña (mínimo 8 caracteres)', autocomplete: 'new-password', hidden: !mustChange });
  const btn = h('button', { class: 'btn-sm btn-primary', type: 'submit', style: { height: '36px', justifyContent: 'center' } }, mustChange ? 'Cambiar contraseña' : 'Entrar');

  const fail = (msg) => { error.hidden = false; error.textContent = msg; btn.disabled = false; };
  const form = h('form', { class: 'login-card', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; error.hidden = true;
    try {
      if (mustChange) {
        const r = await changePassword(pass.value, next.value);
        if (!r.success) return fail(r.error || 'No se pudo cambiar la contraseña');
        const l = await login(user.value, next.value);
        return l.success ? onDone() : fail('Contraseña cambiada: vuelve a entrar');
      }
      const r = await login(user.value, pass.value);
      if (r.success && r.mustChangePassword) return renderLogin(root, { onDone, mustChange: true });
      if (r.success) return onDone();
      fail(r.error || r.message || 'Usuario o contraseña incorrectos');
    } catch { fail('No se pudo conectar con el servidor'); }
  } },
    h('h1', null, h('img', { class: 'logo', src: '../icon.svg', alt: '' }), 'Zer0Code'),
    h('div', { class: 'hint' }, mustChange ? 'Por seguridad, cambia la contraseña inicial.' : `Entra a tu servidor ${location.host}`),
    user, pass, next, error, btn);
  root.append(h('div', { class: 'login drag' }, h('div', { class: 'stage', html: skySvg() }), form));
  (mustChange ? pass : user.value ? pass : user).focus();
}
