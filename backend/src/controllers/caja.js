const db = require('../db/connection');

async function corte(req, res, next) {
  try {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    const eid   = req.user.empresa_id;

    const [pedidosRes, cobrosRes, totRes] = await Promise.all([
      // Pedidos del día por estado
      db.query(
        `SELECT estado, COUNT(*) AS num, COALESCE(SUM(total), 0) AS total
         FROM pedidos
         WHERE empresa_id = $1
           AND DATE(created_at AT TIME ZONE 'America/Mexico_City') = $2
         GROUP BY estado`,
        [eid, fecha]
      ),
      // Cobros del día por método
      db.query(
        `SELECT p.metodo, COUNT(*) AS num, COALESCE(SUM(p.monto), 0) AS total
         FROM pagos_cxc p
         JOIN cuentas_por_cobrar cxc ON cxc.id = p.cxc_id
         WHERE cxc.empresa_id = $1 AND p.fecha = $2
         GROUP BY p.metodo`,
        [eid, fecha]
      ),
      // Resumen pedidos sin cancelados
      db.query(
        `SELECT COUNT(*) AS num, COALESCE(SUM(total), 0) AS total
         FROM pedidos
         WHERE empresa_id = $1
           AND DATE(created_at AT TIME ZONE 'America/Mexico_City') = $2
           AND estado != 'cancelado'`,
        [eid, fecha]
      ),
    ]);

    const totalCobrado = cobrosRes.rows.reduce((s, r) => s + Number(r.total), 0);
    const resumen      = totRes.rows[0];

    res.json({
      fecha,
      pedidos: {
        total:          Number(resumen.total),
        num:            Number(resumen.num),
        ticket_promedio: resumen.num > 0 ? Number(resumen.total) / Number(resumen.num) : 0,
        por_estado:     pedidosRes.rows,
      },
      cobros: {
        total:      totalCobrado,
        por_metodo: cobrosRes.rows,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { corte };
