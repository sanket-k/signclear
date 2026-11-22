module.exports = function handler(req, res) {
  res.status(501).json({ error: "not_implemented", route: "/api/tts", phase: 3 });
};
