// Health check endpoint for Vercel
module.exports = (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'CronosAI Web Reservas Backend',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'production'
  });
};
