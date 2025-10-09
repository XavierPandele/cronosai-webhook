const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { testConnection } = require('./config/database');
const reservasRoutes = require('./routes/reservas');
const winston = require('winston');

// Configurar logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

const app = express();

// Middleware de seguridad
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP por ventana
  message: {
    success: false,
    error: 'Demasiadas solicitudes, intente de nuevo más tarde'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

// CORS
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Middleware para parsear JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging de requests
app.use((req, res, next) => {
  logger.info('Request received', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});

// Rutas
app.use('/api/reservas', reservasRoutes);

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    message: 'CronosAI Web Reservas Backend',
    version: '1.0.0',
    status: 'OK',
    endpoints: {
      disponibilidad: 'POST /api/reservas/disponibilidad',
      crear_reserva: 'POST /api/reservas/crear-reserva',
      cancelar_reserva: 'POST /api/reservas/cancelar-reserva',
      buscar_reservas: 'POST /api/reservas/buscar-reservas',
      obtener_reserva: 'GET /api/reservas/reserva/:id_reserva',
      estadisticas: 'GET /api/reservas/estadisticas',
      health: 'GET /api/reservas/health'
    },
    documentation: 'https://github.com/cronosai/web-reservas'
  });
});

// Middleware para manejo de errores
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  res.status(500).json({
    success: false,
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Algo salió mal'
  });
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint no encontrado',
    message: 'La ruta solicitada no existe'
  });
});

// Exportar para Vercel
module.exports = app;
