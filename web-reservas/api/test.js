// Test endpoint for Vercel
module.exports = (req, res) => {
  res.json({
    success: true,
    message: 'Backend funcionando correctamente',
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url
  });
};
