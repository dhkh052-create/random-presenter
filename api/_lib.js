// 우리말 겨루기 서버 공용 코드 (Vercel 서버리스 함수 + Upstash Redis REST)
// Vercel Storage에서 Upstash Redis를 연결하면 아래 환경변수가 자동으로 들어옵니다.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const P = 'urimal:';

const configured = () => !!(REDIS_URL && REDIS_TOKEN);

async function pipeline(cmds) {
  const r = await fetch(REDIS_URL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('redis http ' + r.status);
  const out = await r.json();
  return out.map((x) => {
    if (x && x.error) throw new Error('redis ' + x.error);
    return x ? x.result : null;
  });
}

// 한국 시간 기준 'YYYY-MM'
function ymKST(offsetMonths = 0) {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0');
}
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

function student(q) {
  const g = parseInt(q.g, 10);
  const c = parseInt(q.c, 10);
  const n = String(q.n || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!(g >= 1 && g <= 6 && c >= 1 && c <= 20 && n)) return null;
  return { g, c, n, key: `${g}-${c}-${n}` };
}
function parseKey(key) {
  const i = key.indexOf('-');
  const j = key.indexOf('-', i + 1);
  if (i < 0 || j < 0) return null;
  return { g: +key.slice(0, i), c: +key.slice(i + 1, j), n: key.slice(j + 1) };
}

function teacherOk(req) {
  const pin = process.env.TEACHER_PIN;
  return !!pin && req.headers['x-teacher-pin'] === pin;
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = { P, configured, pipeline, ymKST, YM, student, parseKey, teacherOk, body, send };
