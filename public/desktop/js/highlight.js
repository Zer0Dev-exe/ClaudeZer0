import { esc } from './dom.js';

// Resaltado de sintaxis mínimo y sin dependencias: sirve para el diff y los bloques de código.
const KEYWORDS = new Set(('abstract as async await break case catch class const continue debugger default delete do else enum export extends ' +
  'false finally for from function get if implements import in instanceof interface let new null of package private protected public readonly ' +
  'return set static super switch this throw true try type typeof undefined var void while with yield ' +
  'def elif except lambda None True False pass raise self print is not and or fn mut impl pub use mod struct trait match loop ' +
  'func go chan defer select nil package var range echo fi then done esac').split(' '));

const TOKEN = /(\/\/.*|#(?!\{).*|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b0x[0-9a-f]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/gi;

/** Una línea de código -> HTML con spans tok-* */
export function highlightLine(line, lang = '') {
  if (lang === 'json' || lang === 'text' || lang === 'txt') lang = '';
  let out = '';
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    out += esc(line.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) out += `<span class="tok-c">${esc(m[0])}</span>`;
    else if (m[2] !== undefined) out += `<span class="tok-s">${esc(m[0])}</span>`;
    else if (m[3] !== undefined) out += `<span class="tok-n">${esc(m[0])}</span>`;
    else if (m[4] !== undefined) out += KEYWORDS.has(m[4]) ? `<span class="tok-k">${esc(m[0])}</span>` : `<span class="tok-f">${esc(m[0])}</span>`;
    else out += KEYWORDS.has(m[5]) ? `<span class="tok-k">${esc(m[0])}</span>` : esc(m[0]);
  }
  return out + esc(line.slice(last));
}

export function languageOf(file) {
  const ext = String(file || '').split('.').pop().toLowerCase();
  return { js: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', jsx: 'js', py: 'py', rs: 'rs', go: 'go', sh: 'sh', json: 'json', md: 'text', css: 'css', html: 'html' }[ext] || '';
}
