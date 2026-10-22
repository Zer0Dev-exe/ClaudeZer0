// Cabecera de Zer0Code: un grafo de agentes (el desarrollador envía trabajo, el revisor responde) con pulsos que
// viajan por las aristas. Es la identidad propia de la app, distinta del cielo de otras apps parecidas.
let counter = 0;

const NODES = [
  { x: 24, y: 52, r: 4.2, c: '#ff8a5c' },
  { x: 86, y: 44, r: 3, c: '#5eead4' },
  { x: 142, y: 56, r: 3.4, c: '#67e8f9' },
  { x: 204, y: 42, r: 4.2, c: '#c4b5fd' },
  { x: 264, y: 54, r: 3, c: '#5eead4' }
];
const EDGES = [
  'M24 52 C48 52 62 44 86 44', 'M86 44 C108 44 120 56 142 56', 'M142 56 C166 56 180 42 204 42',
  'M204 42 C228 42 240 54 264 54', 'M86 44 C128 26 170 26 204 42'
];

export function skySvg() {
  const id = `g${counter++}`;
  const nodes = NODES.map(n => `
    <circle cx="${n.x}" cy="${n.y}" r="${n.r * 3.4}" fill="${n.c}" fill-opacity="0.10"/>
    <circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.c}"/>`).join('');
  const edges = EDGES.map(d => `<path d="${d}" stroke="url(#${id}e)" stroke-width="1" fill="none"/>`).join('');
  const pulses = EDGES.map((d, i) => `
    <path d="${d}" stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none" pathLength="100" stroke-dasharray="6 94" stroke-opacity="0.85">
      <animate attributeName="stroke-dashoffset" from="100" to="0" dur="${2.6 + i * 0.35}s" begin="${i * 0.5}s" repeatCount="indefinite"/>
    </path>`).join('');
  return `<svg fill="none" preserveAspectRatio="xMidYMin slice" viewBox="0 0 288 96" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="288" y2="96" gradientUnits="userSpaceOnUse">
      <stop stop-color="oklch(0.27 0.06 196)"/><stop offset="0.55" stop-color="oklch(0.21 0.05 235)"/><stop offset="1" stop-color="oklch(0.18 0.05 280)"/>
    </linearGradient>
    <radialGradient id="${id}r" cx="0" cy="0" r="1" gradientTransform="translate(230 20) scale(150 90)" gradientUnits="userSpaceOnUse">
      <stop stop-color="oklch(0.78 0.13 185)" stop-opacity="0.34"/><stop offset="1" stop-color="oklch(0.78 0.13 185)" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}v" cx="0" cy="0" r="1" gradientTransform="translate(30 70) scale(110 70)" gradientUnits="userSpaceOnUse">
      <stop stop-color="oklch(0.7 0.17 40)" stop-opacity="0.22"/><stop offset="1" stop-color="oklch(0.7 0.17 40)" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}e" x1="0" y1="0" x2="288" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#ff8a5c" stop-opacity="0.5"/><stop offset="0.5" stop-color="#67e8f9" stop-opacity="0.45"/><stop offset="1" stop-color="#c4b5fd" stop-opacity="0.5"/>
    </linearGradient>
    <pattern id="${id}d" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.7" fill="#fff" fill-opacity="0.16"/></pattern>
  </defs>
  <rect width="288" height="96" fill="url(#${id}b)"/><rect width="288" height="96" fill="url(#${id}r)"/><rect width="288" height="96" fill="url(#${id}v)"/>
  <rect width="288" height="96" fill="url(#${id}d)"/>
  ${edges}${pulses}${nodes}
</svg>`;
}
