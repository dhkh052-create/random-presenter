const { configured, send } = require('./_lib');

module.exports = (req, res) => {
  send(res, 200, { db: configured(), pin: !!process.env.TEACHER_PIN });
};
