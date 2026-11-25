// 내가 만드는 학생생활기록부 (Upstash Redis)
// 학생
//   GET  /api/lifelog?sid=10305&name=김하늘      → 내 기록 불러오기 (학번·이름이 맞을 때만)
//   POST /api/lifelog { sid, name, activities, submit }  → 자동 저장(submit:false) / 제출(submit:true)
// 선생님 (헤더 x-teacher-pin 필요)
//   GET  /api/lifelog?all=1                     → 전체 기록 + 명단
//   POST /api/lifelog { action:'roster', roster:[{sid,name}] }  → 명단 저장
//   POST /api/lifelog { action:'delete', sid }  → 한 학생 기록 삭제
const { configured, pipeline, teacherOk, body, send } = require('./_lib');

const REC = 'lifelog:rec';      // HASH 학번 → 기록 JSON
const ROSTER = 'lifelog:roster'; // STRING 명단 JSON
const SID = /^\d{3,8}$/;
const MAX_ACTS = 30;
const MAX_LEN = 3000;

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
const cleanName = (s) => clean(s, 20).replace(/\s+/g, ' ').trim();
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

module.exports = async (req, res) => {
  if (!configured()) return send(res, 503, { error: 'db not configured' });
  const q = req.query || {};
  try {
    if (req.method === 'GET') {
      if (q.all) {
        if (!process.env.TEACHER_PIN) return send(res, 503, { error: 'TEACHER_PIN not set' });
        if (!teacherOk(req)) return send(res, 401, { error: 'wrong pin' });
        const [flat, roster] = await pipeline([['HGETALL', REC], ['GET', ROSTER]]);
        const records = [];
        for (let i = 0; i < (flat || []).length; i += 2) { const r = parse(flat[i + 1]); if (r) records.push(r); }
        return send(res, 200, { records, roster: parse(roster) || [], now: Date.now() });
      }
      const sid = String(q.sid || '').trim();
      const name = cleanName(q.name);
      if (!SID.test(sid) || !name) return send(res, 400, { error: 'bad student' });
      const [raw] = await pipeline([['HGET', REC, sid]]);
      const r = parse(raw);
      if (r && r.name !== name) return send(res, 409, { error: 'name mismatch' });
      return send(res, 200, { record: r });
    }

    if (req.method === 'POST') {
      const b = body(req);

      if (b.action === 'roster' || b.action === 'delete') {
        if (!teacherOk(req)) return send(res, 401, { error: 'wrong pin' });
        if (b.action === 'roster') {
          const list = (Array.isArray(b.roster) ? b.roster : []).slice(0, 200)
            .map((x) => ({ sid: String(x.sid || '').trim(), name: cleanName(x.name) }))
            .filter((x) => SID.test(x.sid));
          await pipeline([['SET', ROSTER, JSON.stringify(list)]]);
          return send(res, 200, { saved: true, roster: list });
        }
        const sid = String(b.sid || '').trim();
        if (!SID.test(sid)) return send(res, 400, { error: 'bad sid' });
        await pipeline([['HDEL', REC, sid]]);
        return send(res, 200, { deleted: true });
      }

      const sid = String(b.sid || '').trim();
      const name = cleanName(b.name);
      if (!SID.test(sid) || !name || !Array.isArray(b.activities)) return send(res, 400, { error: 'bad record' });
      const activities = b.activities.slice(0, MAX_ACTS).map((a) => ({
        title: clean(a && a.title, 200),
        content: clean(a && a.content, MAX_LEN),
        growth: clean(a && a.growth, MAX_LEN),
      }));
      const [raw] = await pipeline([['HGET', REC, sid]]);
      const prev = parse(raw);
      if (prev && prev.name !== name) return send(res, 409, { error: 'name mismatch' });
      const now = Date.now();
      const rec = {
        sid, name, activities,
        updatedAt: now,
        submittedAt: b.submit === true ? now : (prev && prev.submittedAt) || null,
      };
      await pipeline([['HSET', REC, sid, JSON.stringify(rec)]]);
      return send(res, 200, { saved: true, record: rec });
    }

    send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    send(res, 502, { error: 'db error' });
  }
};
