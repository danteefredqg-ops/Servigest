require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');

const authRoutes         = require('./routes/auth');
const pedidosRoutes      = require('./routes/pedidos');
const clientesRoutes     = require('./routes/clientes');
const cotizacionesRoutes = require('./routes/cotizaciones');
const serviciosRoutes    = require('./routes/servicios');
const productosRoutes    = require('./routes/productos');
const facturasRoutes     = require('./routes/facturas');
const cxcRoutes          = require('./routes/cxc');
const comprasRoutes      = require('./routes/compras');
const importRoutes       = require('./routes/import');
const reportesRoutes     = require('./routes/reportes');
const onboardingRoutes   = require('./routes/onboarding');
const usuariosRoutes     = require('./routes/usuarios');
const auditRoutes        = require('./routes/audit');
const ordenesRoutes      = require('./routes/ordenes');
const alertasRoutes      = require('./routes/alertas');
const cajaRoutes         = require('./routes/caja');
const garantiasRoutes    = require('./routes/garantias');
const modulosRoutes      = require('./routes/modulos');
const errorHandler       = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Seguridad ────────────────────────────────────────────────────────────────
app.use(helmet());

// Rate limiting global
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX)        || 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Demasiadas solicitudes, intenta en unos minutos' },
});
app.use(limiter);

// Rate limiting más estricto para auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiados intentos de autenticación' },
});

// ── Middleware global ────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'https://danteeqg-ux.github.io',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origen no permitido'));
  },
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json({ limit: '10mb' }));

// ── Rutas ────────────────────────────────────────────────────────────────────
app.use('/api/auth',         authLimiter, authRoutes);
app.use('/api/pedidos',      pedidosRoutes);
app.use('/api/clientes',     clientesRoutes);
app.use('/api/cotizaciones', cotizacionesRoutes);
app.use('/api/servicios',    serviciosRoutes);
app.use('/api/productos',    productosRoutes);
app.use('/api/facturas',     facturasRoutes);
app.use('/api/cxc',          cxcRoutes);
app.use('/api/compras',      comprasRoutes);
app.use('/api/import',       importRoutes);
app.use('/api/reportes',     reportesRoutes);
app.use('/api/onboarding',   onboardingRoutes);
app.use('/api/usuarios',     usuariosRoutes);
app.use('/api/audit',        auditRoutes);
app.use('/api/ordenes',      ordenesRoutes);
app.use('/api/alertas',      alertasRoutes);
app.use('/api/caja',         cajaRoutes);
app.use('/api/garantias',    garantiasRoutes);
app.use('/api/modulos',     modulosRoutes);

// Health check — Railway lo usa para verificar que el servicio vive
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ── Manejo de errores (siempre al final) ─────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 ServiGest API corriendo en puerto ${PORT} [${process.env.NODE_ENV}]`);
});
