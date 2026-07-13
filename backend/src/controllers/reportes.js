const db   = require('../db/connection');
const XLSX = require('xlsx');

// GET /api/reportes/ingresos?desde=&hasta=&formato=json|xlsx
async function ingresos(req, res, next) {
  try {
    const { desde, hasta, formato = 'json' } = req.query;
    const empresa_id = req.user.empresa_id;

    const result = await db.query(
      `SELECT
         date_trunc('day', p.created_at)  AS fecha,
         COUNT(*)                          AS pedidos,
         SUM(p.total)                      AS ingresos,
         AVG(p.total)                      AS ticket_promedio,
         COUNT(DISTINCT p.cliente_id)      AS clientes_unicos
       FROM pedidos p
       WHERE p.empresa_id = $1
         AND p.estado = 'entregado'
         AND ($2::timestamptz IS NULL OR p.created_at >= $2)
         AND ($3::timestamptz IS NULL OR p.created_at <= $3)
       GROUP BY date_trunc('day', p.created_at)
       ORDER BY fecha ASC`,
      [empresa_id, desde || null, hasta || null]
    );

    if (formato === 'xlsx') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(result.rows.map(r => ({
        Fecha:           new Date(r.fecha).toLocaleDateString('es-MX'),
        Pedidos:         r.pedidos,
        'Ingresos ($)':  Number(r.ingresos).toFixed(2),
        'Ticket Prom.':  Number(r.ticket_promedio).toFixed(2),
        'Clientes':      r.clientes_unicos,
      })));
      XLSX.utils.book_append_sheet(wb, ws, 'Ingresos');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="reporte_ingresos.xlsx"');
      return res.send(buf);
    }

    res.json(result.rows);
  } catch (err) { next(err); }
}

// GET /api/reportes/clientes-top
async function clientesTop(req, res, next) {
  try {
    const result = await db.query(
      `SELECT c.nombre, c.telefono, c.email,
              COUNT(p.id)     AS pedidos,
              SUM(p.total)    AS total_facturado,
              MAX(p.created_at) AS ultimo_pedido
       FROM clientes c
       LEFT JOIN pedidos p ON p.cliente_id = c.id AND p.estado = 'entregado'
       WHERE c.empresa_id = $1
       GROUP BY c.id
       ORDER BY total_facturado DESC NULLS LAST
       LIMIT 20`,
      [req.user.empresa_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

// GET /api/reportes/cxc-vencidas
async function cxcVencidas(req, res, next) {
  try {
    // Calcula vencidas on-the-fly sin modificar estado en DB
    // (la actualización de estado se hace al cobrar o desde CxC directamente)
    const result = await db.query(
      `SELECT cxc.*, c.nombre AS cliente_nombre, c.telefono AS cliente_tel,
              CURRENT_DATE - cxc.fecha_vence AS dias_vencida
       FROM cuentas_por_cobrar cxc
       JOIN clientes c ON c.id = cxc.cliente_id
       WHERE cxc.empresa_id = $1
         AND (cxc.estado = 'vencida'
              OR (cxc.estado IN ('pendiente','parcial') AND cxc.fecha_vence < CURRENT_DATE))
       ORDER BY (CURRENT_DATE - cxc.fecha_vence) DESC`,
      [req.user.empresa_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

// GET /api/reportes/dashboard-completo — un solo endpoint para el dashboard
async function dashboardCompleto(req, res, next) {
  try {
    const id = req.user.empresa_id;
    const [pedidos, cxc, stockBajo] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE estado='pendiente')  AS pendientes,
           COUNT(*) FILTER (WHERE estado='en_camino')  AS en_camino,
           COUNT(*) FILTER (WHERE estado='entregado')  AS entregados,
           COUNT(*) FILTER (WHERE estado='cancelado')  AS cancelados,
           COALESCE(SUM(total) FILTER (WHERE estado='entregado'
             AND created_at >= date_trunc('day', NOW())), 0) AS cobrado_hoy,
           COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW())) AS pedidos_hoy,
           COALESCE(SUM(total) FILTER (WHERE estado='entregado'
             AND created_at >= date_trunc('month', NOW())), 0) AS cobrado_mes
         FROM pedidos WHERE empresa_id = $1`,
        [id]
      ),
      db.query(
        `SELECT
           COALESCE(SUM(monto-monto_pagado) FILTER (WHERE estado IN ('pendiente','parcial')),0) AS por_cobrar,
           COALESCE(SUM(monto-monto_pagado) FILTER (WHERE estado='vencida'),0) AS vencido
         FROM cuentas_por_cobrar WHERE empresa_id = $1`,
        [id]
      ),
      db.query(
        `SELECT COUNT(*) AS productos_stock_bajo
         FROM productos WHERE empresa_id = $1 AND activo=true AND stock <= stock_minimo AND stock_minimo > 0`,
        [id]
      ),
    ]);

    res.json({
      ...pedidos.rows[0],
      ...cxc.rows[0],
      ...stockBajo.rows[0],
    });
  } catch (err) { next(err); }
}

module.exports = { ingresos, clientesTop, cxcVencidas, dashboardCompleto };
