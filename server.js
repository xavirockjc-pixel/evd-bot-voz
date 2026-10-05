/* ════════════════════════════════════════════════════════════
   Él Va Delante · Servicio de voz GRATIS para el bot de Telegram
   Texto -> voz neuronal (edge-tts) -> OGG/Opus (nota de voz).
   Sin API key externa, sin costo por carácter.

   Endpoints:
     GET  /health              -> "ok"
     POST /tts  {text, voice?, rate?, pitch?, format?}
          -> audio/ogg (nota de voz)  |  format:"mp3" -> audio/mpeg
   Seguridad opcional: si defines TTS_KEY, exige header  x-api-key.
   ════════════════════════════════════════════════════════════ */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const PORT   = process.env.PORT || 8080;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const KEY    = process.env.TTS_KEY || '';
const VOICE_DEF = process.env.TTS_VOICE || 'es-CL-LorenzoNeural';
// Publicación a Telegram (SIN n8n)
const TG_TOKEN = process.env.TELEGRAM_TOKEN || '';
const TG_CHAT  = process.env.TELEGRAM_CHAT  || '';   // @canal o id numérico
const DATA_DIR = process.env.DATA_DIR || __dirname;

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-api-key' });
  res.end(body);
}

async function synthWebm(text, voice, rate, pitch) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
  const opts = {};
  if (rate)  opts.rate  = rate;   // ej "-8%"
  if (pitch) opts.pitch = pitch;  // ej "-2Hz"
  const tmp = path.join(os.tmpdir(), 'tts_' + process.pid + '_' + Date.now() + '.webm');
  await new Promise((resolve, reject) => {
    const { audioStream } = tts.toStream(text, opts);
    const ws = fs.createWriteStream(tmp);
    audioStream.on('data', d => ws.write(d));
    audioStream.on('end', () => { ws.end(); resolve(); });
    audioStream.on('error', reject);
    setTimeout(() => { try { ws.end(); } catch (e) {} resolve(); }, 30000);
  });
  return tmp;
}

function transcode(inPath, fmt) {
  // fmt: 'ogg' (opus, nota de voz) | 'mp3'
  const args = fmt === 'mp3'
    ? ['-y', '-i', inPath, '-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1']
    : ['-y', '-i', inPath, '-c:a', 'libopus', '-b:a', '48k', '-ar', '48000', '-ac', '1', '-f', 'ogg', 'pipe:1'];
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, args);
    const chunks = [];
    ff.stdout.on('data', d => chunks.push(d));
    ff.on('error', reject);
    ff.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('ffmpeg ' + code)));
  });
}

// ---- Telegram sendVoice (texto como caption) + fallback texto largo ----
const https = require('https');
function tgCall(method, fields, fileField) {
  return new Promise((resolve, reject) => {
    const boundary = '----evd' + Date.now();
    const parts = [];
    for (const k in fields) {
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + fields[k] + '\r\n'));
    }
    if (fileField) {
      parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + fileField.name + '"; filename="voz.ogg"\r\nContent-Type: audio/ogg\r\n\r\n'));
      parts.push(fileField.buffer);
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from('--' + boundary + '--\r\n'));
    const body = Buffer.concat(parts);
    const r = https.request({
      hostname: 'api.telegram.org', path: '/bot' + TG_TOKEN + '/' + method, method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length }
    }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => resolve({ status: resp.statusCode, body: d })); });
    r.on('error', reject); r.write(body); r.end();
  });
}

// ---- Rotación de devocionales (SIN n8n): toma el siguiente de la lista ----
function nextDevocional() {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(__dirname, 'devocionales.json'), 'utf8')); } catch (e) {}
  if (!list.length) return null;
  const stateFile = path.join(DATA_DIR, 'estado.json');
  let i = 0; try { i = JSON.parse(fs.readFileSync(stateFile, 'utf8')).i || 0; } catch (e) {}
  const item = list[i % list.length];
  try { fs.writeFileSync(stateFile, JSON.stringify({ i: (i + 1) % list.length })); } catch (e) {}
  return item;
}

async function publicar(text) {
  const webm = await synthWebm(text, VOICE_DEF);
  const ogg = await transcode(webm, 'ogg');
  fs.unlink(webm, () => {});
  if (!TG_TOKEN || !TG_CHAT) {
    return { ok: false, reason: 'faltan TELEGRAM_TOKEN/TELEGRAM_CHAT', audioBytes: ogg.length, textPreview: text.slice(0, 80) };
  }
  // Telegram corta caption a ~1024: si es largo, texto aparte + voz sin caption
  let r1 = null;
  if (text.length > 1000) r1 = await tgCall('sendMessage', { chat_id: TG_CHAT, text: text });
  const r2 = await tgCall('sendVoice',
    text.length > 1000 ? { chat_id: TG_CHAT } : { chat_id: TG_CHAT, caption: text },
    { name: 'voice', buffer: ogg });
  return { ok: r2.status === 200, sendMessage: r1 && r1.status, sendVoice: r2.status, resp: r2.body.slice(0, 200) };
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '');
  if (req.method === 'GET' && req.url.startsWith('/health')) return send(res, 200, 'text/plain', 'ok');

  // Publicar la Palabra del día (texto + voz) a Telegram, SIN n8n.
  // POST /publish  {text?}  (si no mandas text, toma el siguiente de devocionales.json)
  if (req.method === 'POST' && req.url.startsWith('/publish')) {
    let raw = ''; req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      try {
        if (KEY && req.headers['x-api-key'] !== KEY) return send(res, 401, 'text/plain', 'unauthorized');
        const b = raw ? JSON.parse(raw) : {};
        let text = (b.text || '').toString().trim();
        if (!text) { const d = nextDevocional(); text = d ? (d.text || d.texto || d) : ''; }
        if (!text) return send(res, 400, 'text/plain', 'sin texto ni devocionales.json');
        const out = await publicar(text);
        send(res, 200, 'application/json', JSON.stringify(out));
      } catch (e) { send(res, 500, 'text/plain', 'error: ' + (e && e.message || e)); }
    });
    return;
  }

  if (req.method !== 'POST' || !req.url.startsWith('/tts')) return send(res, 404, 'text/plain', 'not found');

  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    try {
      if (KEY && req.headers['x-api-key'] !== KEY) return send(res, 401, 'text/plain', 'unauthorized');
      const b = raw ? JSON.parse(raw) : {};
      const text = (b.text || '').toString().trim();
      if (!text) return send(res, 400, 'text/plain', 'falta "text"');
      const voice = b.voice || VOICE_DEF;
      const fmt = (b.format === 'mp3') ? 'mp3' : 'ogg';
      const webm = await synthWebm(text, voice, b.rate, b.pitch);
      const out = await transcode(webm, fmt);
      fs.unlink(webm, () => {});
      send(res, 200, fmt === 'mp3' ? 'audio/mpeg' : 'audio/ogg', out);
    } catch (e) {
      send(res, 500, 'text/plain', 'error: ' + (e && e.message || e));
    }
  });
});

server.listen(PORT, () => console.log('TTS voz EVD escuchando en :' + PORT + ' · voz por defecto ' + VOICE_DEF));
