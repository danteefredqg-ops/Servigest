// audit.js — middleware y helper para registrar acciones en audit_logs
// Uso en controller: await log(req, 'crear_pedido', 'pedido', result.id, { monto: 1500 })

const db = require('../db/connection');

// ── Helper directo (se llama desde controllers) ───────────────────────────────
async function log(req, accion, entidad, entidad_id = null, detalle = {}) {
  try {
    await db.query(
      `INSERT INTO audit_logs
         (empresa_id, usuario_id, usuario_nombre, accion, entidad, entidad_id, detalle, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.user.empresa_id,
        req.user.id,
        req.user.nombre || null,
        accion,
        entidad,
        entidad_id || null,
        JSON.stringify(detalle),
        req.ip || req.headers['x-forwarded-for'] || null,
      ]
    );
  } catch (err) {
    // Los logs nunca deben romper el flujo principal
    console.error('[audit] Error al registrar log:', err.message);
  }
}

module.exports = { log };
