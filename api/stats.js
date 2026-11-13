// 선생님용 기록 조회: GET ?months=2026-11,2026-10  (헤더 x-teacher-pin 필요)
const { P, configured, pipeline, YM, parseKey, teacherOk, send } = require('./_lib');

module.exports = async (req, res) => {
  if (!configured()) return send(res, 503, { error: 'db not configured' });
  if (!process.env.TEACHER_PIN) return send(res, 503, { error: 'TEACHER_PIN not set' });
  if (!teacherOk(req)) return send(res, 401, { error: 'wrong pin' });
  const months = String((req.query || {}).months || '')
    .split(',').filter((m) => YM.test(m)).slice(0, 24);
  if (!months.length) return send(res, 200, { students: {} });
  try {
    const cmds = [];
    months.forEach((m) => { cmds.push(['HGETALL', P + 'ok:' + m], ['HGETALL', P + 't:' + m]); });
    const out = await pipeline(cmds);
    const students = {};
    months.forEach((m, i) => {
      const okArr = out[i * 2] || [];
      const tArr = out[i * 2 + 1] || [];
      const okMap = {};
      for (let k = 0; k < okArr.length; k += 2) okMap[okArr[k]] = +okArr[k + 1] || 0;
      for (let k = 0; k < tArr.length; k += 2) {
        const key = tArr[k];
        const who = parseKey(key);
        if (!who) continue;
        const st = students[key] || (students[key] = { ...who, m: {} });
        st.m[m] = [okMap[key] || 0, +tArr[k + 1] || 0];
      }
    });
    send(res, 200, { students });
  } catch (e) {
    send(res, 502, { error: 'db error' });
  }
};
