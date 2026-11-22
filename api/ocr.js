module.exports = function handler(req, res) {
  res.status(501).json({ error: "not_implemented", route: "/api/ocr", phase: 3 });
};
