// 자모 냠냠 온라인 순위 (Upstash Redis 정렬 집합)
// GET  /api/jamo-rank?id=기기ID   → 상위 20명 + 내 순위
// POST /api/jamo-rank { id, name, score, stage } → 최고 점수만 저장, 내 순위 반환
//   stage: 도달한 단계 1~5, 6 = 모두 완주(한글 박사)
const { configured, pipeline, body, send } = require('./_lib');

const K = 'jamo:rank';   // ZSET id → 최고 점수
const N = 'jamo:names';  // HASH id → 이름
const S = 'jamo:stage';  // HASH id → 최고 점수 때의 단계
const TOP = 20;
const MAX_SCORE = 90000; // '빠르게'(×1.5)로 모든 자모를 최대 콤보로 먹어도 넘을 수 없는 값
const ID = /^[a-z0-9]{8,24}$/;

const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>&"']/g, '').trim().replace(/\s+/g, ' ').slice(0, 10);

async function board(id) {
  const [flat, total] = await pipeline([['ZREVRANGE', K, 0, TOP - 1, 'WITHSCORES'], ['ZCARD', K]]);
  const ids = [];
  const scores = [];
  for (let i = 0; i < (flat || []).length; i += 2) { ids.push(flat[i]); scores.push(+flat[i + 1] || 0); }
  let names = [];
  let stages = [];
  if (ids.length) [names, stages] = await pipeline([['HMGET', N, ...ids], ['HMGET', S, ...ids]]);
  // 같은 점수는 같은 순위
  let rank = 0;
  const top = ids.map((x, i) => {
    if (i === 0 || scores[i] < scores[i - 1]) rank = i + 1;
    return { rank, name: (names && names[i]) || '익명', score: scores[i], stage: +(stages && stages[i]) || 1, me: x === id };
  });
  let me = null;
  if (id && ID.test(id)) {
    const [sc] = await pipeline([['ZSCORE', K, id]]);
    if (sc != null) {
      const [higher] = await pipeline([['ZCOUNT', K, '(' + sc, '+inf']]);
      me = { rank: (+higher || 0) + 1, score: +sc };
    }
  }
  return { top, total: +total || 0, me };
}

module.exports = async (req, res) => {
  if (!configured()) return send(res, 503, { error: 'db not configured' });
  try {
    if (req.method === 'POST') {
      const b = body(req);
      const id = String(b.id || '');
      const name = cleanName(b.name);
      const score = Math.floor(Number(b.score));
      const stage = Math.floor(Number(b.stage));
      if (!ID.test(id) || !name || !(score >= 0 && score <= MAX_SCORE) || !(stage >= 1 && stage <= 6)) {
        return send(res, 400, { error: 'bad record' });
      }
      const [prev] = await pipeline([['ZSCORE', K, id]]);
      const best = prev == null || score > +prev;
      const cmds = [['HSET', N, id, name]];
      if (best) cmds.push(['ZADD', K, score, id], ['HSET', S, id, stage]);
      await pipeline(cmds);
      return send(res, 200, { saved: true, best, ...(await board(id)) });
    }
    if (req.method === 'GET') {
      return send(res, 200, await board(String((req.query || {}).id || '')));
    }
    send(res, 405, { error: 'GET or POST only' });
  } catch (e) {
    send(res, 502, { error: 'db error' });
  }
};
