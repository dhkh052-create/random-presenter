// 선생님용 전체 기록 삭제: POST (헤더 x-teacher-pin 필요)
const { P, configured, pipeline, teacherOk, send } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!configured()) return send(res, 503, { error: 'db not configured' });
  if (!teacherOk(req)) return send(res, 401, { error: 'wrong pin' });
  try {
    const [months] = await pipeline([['SMEMBERS', P + 'months']]);
    const keys = [P + 'months'];
    (months || []).forEach((m) => keys.push(P + 'ok:' + m, P + 't:' + m));
    await pipeline([['DEL', ...keys]]);
    send(res, 200, { deleted: true });
  } catch (e) {
    send(res, 502, { error: 'db error' });
  }
};
