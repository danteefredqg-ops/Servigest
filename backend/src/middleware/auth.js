const jwt = require('jsonwebtoken');
const db  = require('../db/connection');

// ── Autenticación base ────────────────────────────────────────────────────────
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  let payload;
  try {
    payload = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  req.user = {
    id:         payload.id,
    empresa_id: payload.empresa_id,
    rol:        payload.rol || 'admin',
    nombre:     payload.nombre || null,
    // plan y plan_vence se sobreescriben con datos de DB abajo
    plan:        payload.plan,
    trial_hasta: payload.trial_hasta,
  };

  // Verificar plan desde DB (fuente de verdad — refleja pagos/cancelaciones sin re-login)
  try {
    const { rows } = await db.query(
      `SELECT plan, plan_vence, trial_hasta, stripe_customer_id
       FROM empresas WHERE id = $1`,
      [payload.empresa_id]
    );
    if (rows[0]) {
      req.user.plan              = rows[0].plan;
      req.user.plan_vence        = rows[0].plan_vence;
      req.user.trial_hasta       = rows[0].trial_hasta;
      req.user.tiene_suscripcion = !!rows[0].stripe_customer_id;
    }
  } catch {
    // Si falla el DB check usamos datos del JWT como fallback
  }

  const ahora = new Date();

  // Trial expirado → bloqueo total
  if (req.user.plan === 'trial' && req.user.trial_hasta && new Date(req.user.trial_hasta) < ahora) {
    return res.status(402).json({
      error:       'trial_expirado',
      trial_hasta: req.user.trial_hasta,
      mensaje:     'Tu período de prueba ha terminado. Activa un plan para continuar.',
    });
  }

  // Plan pagado vencido → modo lectura (GETs pasan, writes bloqueados)
  if (req.user.plan !== 'trial' && req.user.plan_vence && new Date(req.user.plan_vence) < ahora) {
    req.user.modo_lectura = true;
    if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
      return res.status(402).json({
        error:   'plan_vencido',
        modo:    'lectura',
        mensaje: 'Tu plan venció. Renueva en Ajustes para continuar.',
      });
    }
  }

  next();
}

// ── Fábrica de middleware por rol ─────────────────────────────────────────────
function roles(...permitidos) {
  return (req, res, next) => {
    if (!permitidos.includes(req.user.rol)) {
      return res.status(403).json({
        error: `Acceso denegado. Se requiere rol: ${permitidos.join(' o ')}`,
      });
    }
    next();
  };
}

// ── Atajos semánticos ─────────────────────────────────────────────────────────
const soloAdmin      = roles('admin', 'superadmin');
const adminOContador = roles('admin', 'superadmin', 'contador');

module.exports = { authMiddleware, roles, soloAdmin, adminOContador };
