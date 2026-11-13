// 학생 한 문제 결과 저장: POST { g, c, n, ok, ym? }
const { P, configured, pipeline, ymKST, YM, student, body, send } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!configured()) return send(res, 503, { error: 'db not configured' });
  const b = body(req);
  const s = student(b);
  if (!s) return send(res, 400, { error: 'bad student' });
  // 오프라인으로 밀린 기록은 그때의 달로 넣되, 이번 달·지난 달만 허용
  let ym = ymKST();
  if (typeof b.ym === 'string' && YM.test(b.ym) && (b.ym === ymKST() || b.ym === ymKST(-1))) ym = b.ym;
  const cmds = [['SADD', P + 'months', ym], ['HINCRBY', P + 't:' + ym, s.key, 1]];
  if (b.ok === true) cmds.push(['HINCRBY', P + 'ok:' + ym, s.key, 1]);
  try {
    await pipeline(cmds);
    send(res, 200, { saved: true });
  } catch (e) {
    send(res, 502, { error: 'db error' });
  }
};
