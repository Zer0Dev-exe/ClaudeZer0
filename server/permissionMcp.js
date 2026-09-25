// Servidor MCP mínimo (stdio, sin dependencias) que Claude Code usa como --permission-prompt-tool.
// Cuando el CLI necesita permiso para una herramienta, llama a `approve`; aquí se reenvía la petición
// al servidor de ClaudeZer0, que la muestra en la web y espera la respuesta del usuario.
import http from 'http';
import readline from 'readline';

const CALLBACK_URL = process.env.CLAUDEZER0_PERMISSION_URL;
const SECRET = process.env.CLAUDEZER0_PERMISSION_SECRET;

const TOOL = {
  name: 'approve',
  description: 'Uso interno de ClaudeZer0: pide al usuario permiso para ejecutar una herramienta. No lo llames directamente.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
      tool_use_id: { type: 'string' }
    },
    required: ['tool_name', 'input']
  }
};

function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

// http en vez de fetch: la espera puede durar minutos y fetch corta a los 5 min sin cabeceras
function askServer(payload) {
  return new Promise((resolve) => {
    const deny = (message) => resolve({ behavior: 'deny', message });
    if (!CALLBACK_URL || !SECRET) return deny('ClaudeZer0 no ha configurado el puente de permisos.');

    const body = JSON.stringify(payload);
    const req = http.request(CALLBACK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-claudezer0-secret': SECRET
      }
    }, (res) => {
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const decision = JSON.parse(data);
          if (decision && (decision.behavior === 'allow' || decision.behavior === 'deny')) return resolve(decision);
        } catch {
          // respuesta no válida: se deniega abajo
        }
        deny('Respuesta no válida del servidor de ClaudeZer0.');
      });
    });
    req.on('error', (err) => deny(`No se pudo contactar con ClaudeZer0: ${err.message}`));
    req.end(body);
  });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notificaciones

  switch (method) {
    case 'initialize':
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'claudezer0', version: '1.0.0' }
        }
      });
    case 'ping':
      return send({ id, result: {} });
    case 'tools/list':
      return send({ id, result: { tools: [TOOL] } });
    case 'tools/call': {
      if (params?.name !== TOOL.name) {
        return send({ id, error: { code: -32602, message: `Herramienta desconocida: ${params?.name}` } });
      }
      const args = params.arguments || {};
      const decision = await askServer({
        tool_name: args.tool_name,
        input: args.input || {},
        tool_use_id: args.tool_use_id || null
      });
      if (decision.behavior === 'allow' && !decision.updatedInput) decision.updatedInput = args.input || {};
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
    }
    default:
      return send({ id, error: { code: -32601, message: `Método no soportado: ${method}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  handle(msg).catch((err) => {
    if (msg.id !== undefined) send({ id: msg.id, error: { code: -32603, message: err.message } });
  });
});
rl.on('close', () => process.exit(0));
