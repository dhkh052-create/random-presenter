// 학생 본인의 이번 달 기록: GET ?g=&c=&n=
const { P, configured, pipeline, ymKST, student, send } = require('./_lib');

module.exports = async (req, res) => {
  if (!configured()) return send(res, 503, { error: 'db not configured' });
  const s = student(req.query || {});
  if (!s) return send(res, 400, { error: 'bad student' });
  const ym = ymKST();
  try {
    const [ok, t] = await pipeline([['HGET', P + 'ok:' + ym, s.key], ['HGET', P + 't:' + ym, s.key]]);
    send(res, 200, { ym, ok: +ok || 0, t: +t || 0 });
  } catch (e) {
    send(res, 502, { error: 'db error' });
  }
};
