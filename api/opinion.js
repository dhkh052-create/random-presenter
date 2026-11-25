// 우리 반 의견 모으기 (Upstash Redis)
// 학생
//   GET  /api/opinion?sid=10305&name=김하늘           → 시트(열린 질문 × 반 학생). 남의 칸은 공개일 때만 글
//   POST /api/opinion { id, sid, name, text }        → 내 칸 저장(한 질문에 하나, 빈칸이면 지움)
// 선생님 (헤더 x-teacher-pin 필요)
//   GET  /api/opinion?all=1                          → 모든 질문 + 모든 의견 + 명단
//   POST { action:'create', q }                      → 질문 만들기
//   POST { action:'update', id, q?, open?, wall? }   → 질문 수정 / 받기 열기·닫기 / 의견 공개
//   POST { action:'removeTopic', id }                → 질문과 의견 모두 삭제
//   POST { action:'removeAnswer', id, sid }          → 의견 하나 삭제
//   POST { action:'roster', roster:[{sid,name}] }    → 명단 저장 (생활기록부와 같은 명단)
const { configured, pipeline, teacherOk, body, send } = require('./_lib');

const TOPICS = 'opinion:topics';      // STRING 질문 목록 JSON
const ANS = (id) => 'opinion:a:' + id; // HASH 학번 → 의견 JSON
const ROSTER = 'lifelog:roster';       // 생활기록부와 같은 명단
const SID = /^\d{3,8}$/;
const TID = /^[a-z0-9]{6,16}$/;
const MAX_TEXT = 300;

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const cleanName = (s) => clean(s, 20).replace(/\s+/g, ' ');
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

async function getTopics() {
  const [raw] = await pipeline([['GET', TOPICS]]);
  return parse(raw) || [];
}

module.exports = async (req, res) => {
  if (!configured()) return send(res, 503, { error: 'db not configured' });
  const q = req.query || {};
  try {
    if (req.method === 'GET') {
      const topics = await getTopics();
      if (q.all) {
        if (!process.env.TEACHER_PIN) return send(res, 503, { error: 'TEACHER_PIN not set' });
        if (!teacherOk(req)) return send(res, 401, { error: 'wrong pin' });
        const cmds = topics.map((t) => ['HGETALL', ANS(t.id)]);
        cmds.push(['GET', ROSTER]);
        const out = await pipeline(cmds);
        const roster = parse(out.pop()) || [];
        const byTopic = {};
        topics.forEach((t, i) => {
          const flat = out[i] || [];
          const list = [];
          for (let k = 0; k < flat.length; k += 2) { const a = parse(flat[k + 1]); if (a) list.push(a); }
          byTopic[t.id] = list;
        });
        return send(res, 200, { topics, answers: byTopic, roster, now: Date.now() });
      }
      // 학생용 시트: 열린 질문(열) × 반 학생(줄)
      // 남의 칸은 '공개'일 때만 글이 보이고, 아니면 냈는지(✔)만 보임. 학번은 내 줄만 알려 줌.
      const open = topics.filter((t) => t.open).sort((a, b) => a.createdAt - b.createdAt);
      const sid = String(q.sid || '').trim();
      const name = cleanName(q.name);
      const out = await pipeline([...open.map((t) => ['HGETALL', ANS(t.id)]), ['GET', ROSTER]]);
      const roster = parse(out.pop()) || [];
      const rows = roster.map((p) => ({ sid: p.sid, name: p.name, cells: {} }));
      const bySid = {}; rows.forEach((r) => { bySid[r.sid] = r; });
      let conflict = false;
      open.forEach((t, i) => {
        const flat = out[i] || [];
        for (let k = 0; k < flat.length; k += 2) {
          const a = parse(flat[k + 1]); if (!a) continue;
          let r = bySid[a.sid];
          if (!r) { r = bySid[a.sid] = { sid: a.sid, name: a.name, cells: {} }; rows.push(r); }
          if (a.sid === sid && a.name !== name) conflict = true;
          r.cells[t.id] = a;
        }
      });
      if (sid && name && !bySid[sid]) rows.push(bySid[sid] = { sid, name, cells: {} });
      rows.sort((x, y) => x.sid.localeCompare(y.sid, 'ko', { numeric: true }));
      const sheet = rows.map((r) => {
        const me = r.sid === sid && r.name === name;
        const cells = {};
        open.forEach((t) => {
          const a = r.cells[t.id];
          cells[t.id] = !a ? null : (me || t.wall) ? a.text : true;
        });
        return { name: r.name, me, cells };
      });
      return send(res, 200, { topics: open.map((t) => ({ id: t.id, q: t.q, wall: t.wall })), rows: sheet, conflict });
    }

    if (req.method === 'POST') {
      const b = body(req);

      if (b.action) {
        if (!teacherOk(req)) return send(res, 401, { error: 'wrong pin' });
        let topics = await getTopics();
        if (b.action === 'create') {
          const text = clean(b.q, 200);
          if (!text) return send(res, 400, { error: 'empty question' });
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          topics.unshift({ id, q: text, open: true, wall: true, createdAt: Date.now() });
          await pipeline([['SET', TOPICS, JSON.stringify(topics.slice(0, 50))]]);
          return send(res, 200, { topics });
        }
        if (b.action === 'update') {
          const t = topics.find((x) => x.id === b.id);
          if (!t) return send(res, 404, { error: 'no topic' });
          if (typeof b.q === 'string' && clean(b.q, 200)) t.q = clean(b.q, 200);
          if (typeof b.open === 'boolean') t.open = b.open;
          if (typeof b.wall === 'boolean') t.wall = b.wall;
          await pipeline([['SET', TOPICS, JSON.stringify(topics)]]);
          return send(res, 200, { topics });
        }
        if (b.action === 'removeTopic') {
          if (!TID.test(String(b.id))) return send(res, 400, { error: 'bad id' });
          topics = topics.filter((x) => x.id !== b.id);
          await pipeline([['SET', TOPICS, JSON.stringify(topics)], ['DEL', ANS(b.id)]]);
          return send(res, 200, { topics });
        }
        if (b.action === 'removeAnswer') {
          if (!TID.test(String(b.id)) || !SID.test(String(b.sid))) return send(res, 400, { error: 'bad id' });
          await pipeline([['HDEL', ANS(b.id), String(b.sid)]]);
          return send(res, 200, { deleted: true });
        }
        if (b.action === 'roster') {
          const list = (Array.isArray(b.roster) ? b.roster : []).slice(0, 200)
            .map((x) => ({ sid: String(x.sid || '').trim(), name: cleanName(x.name) }))
            .filter((x) => SID.test(x.sid));
          await pipeline([['SET', ROSTER, JSON.stringify(list)]]);
          return send(res, 200, { roster: list });
        }
        return send(res, 400, { error: 'bad action' });
      }

      const sid = String(b.sid || '').trim();
      const name = cleanName(b.name);
      const text = clean(b.text, MAX_TEXT);
      if (!SID.test(sid) || !name || !TID.test(String(b.id))) return send(res, 400, { error: 'bad student' });
      const t = (await getTopics()).find((x) => x.id === b.id);
      if (!t || !t.open) return send(res, 404, { error: 'closed' });
      const [raw] = await pipeline([['HGET', ANS(t.id), sid]]);
      const prev = parse(raw);
      if (prev && prev.name !== name) return send(res, 409, { error: 'name mismatch' });
      if (!text) { // 칸을 비우면 내 의견 지우기
        if (prev) await pipeline([['HDEL', ANS(t.id), sid]]);
        return send(res, 200, { saved: true, mine: null });
      }
      const now = Date.now();
      const ans = { sid, name, text, createdAt: (prev && prev.createdAt) || now, updatedAt: now };
      await pipeline([['HSET', ANS(t.id), sid, JSON.stringify(ans)]]);
      return send(res, 200, { saved: true, mine: ans });
    }

    send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    send(res, 502, { error: 'db error' });
  }
};
