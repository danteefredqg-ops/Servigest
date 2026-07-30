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

// GET /api/reportes/contpaq?desde=&hasta=
async function exportContpaq(req, res, next) {
  try {
    const eid = req.user.empresa_id;
    const hoy = new Date();
    const dDesde = req.query.desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0,10);
    const dHasta = req.query.hasta || hoy.toISOString().slice(0,10);
    const fmt    = d => d ? new Date(d).toLocaleDateString('es-MX') : '';

    const [ventas, compras, cxc, cxp, inventario] = await Promise.all([
      db.query(`
        SELECT p.numero, p.created_at, c.nombre AS cliente, c.rfc,
               p.subtotal, (p.total - p.subtotal) AS iva, p.total, p.forma_pago
        FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
        WHERE p.empresa_id = $1 AND p.estado = 'entregado'
          AND p.created_at::date BETWEEN $2 AND $3
        ORDER BY p.created_at`, [eid, dDesde, dHasta]),

      db.query(`
        SELECT proveedor, descripcion, total, estado, fecha_entrega, created_at
        FROM compras WHERE empresa_id = $1
          AND created_at::date BETWEEN $2 AND $3
        ORDER BY created_at`, [eid, dDesde, dHasta]),

      db.query(`
        SELECT c.nombre AS cliente, cxc.monto, cxc.monto_pagado,
               cxc.monto - cxc.monto_pagado AS saldo, cxc.estado, cxc.fecha_vence, cxc.notas
        FROM cuentas_por_cobrar cxc JOIN clientes c ON c.id = cxc.cliente_id
        WHERE cxc.empresa_id = $1
          AND cxc.created_at::date BETWEEN $2 AND $3
        ORDER BY cxc.fecha_vence`, [eid, dDesde, dHasta]),

      db.query(`
        SELECT proveedor, descripcion, monto_total, monto_pagado,
               monto_total - monto_pagado AS saldo, fecha_vencimiento, notas, created_at
        FROM cuentas_por_pagar WHERE empresa_id = $1
          AND created_at::date BETWEEN $2 AND $3
        ORDER BY fecha_vencimiento NULLS LAST`, [eid, dDesde, dHasta]),

      db.query(`
        SELECT nombre, sku, precio, costo, costo_promedio, stock, unidad, proveedor
        FROM productos WHERE empresa_id = $1 AND activo = true
        ORDER BY nombre`, [eid]),
    ]);

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ventas.rows.map(r => ({
      'Fecha':       fmt(r.created_at),
      'N° Pedido':   r.numero,
      'Cliente':     r.cliente,
      'RFC':         r.rfc || '',
      'Subtotal':    Number(r.subtotal),
      'IVA 16%':     Number(r.iva),
      'Total':       Number(r.total),
      'Forma Pago':  r.forma_pago || '',
      'Cta. Cargo (sugerida)':  '105-01 Clientes',
      'Cta. Abono (sugerida)':  '401-01 Ventas',
    }))), 'Ventas');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compras.rows.map(r => ({
      'Fecha':       fmt(r.created_at),
      'Proveedor':   r.proveedor,
      'Descripción': r.descripcion || '',
      'Total':       Number(r.total),
      'Estado':      r.estado,
      'F. Entrega':  fmt(r.fecha_entrega),
      'Cta. Cargo (sugerida)':  '105-00 Inventario / 501-01 Costo',
      'Cta. Abono (sugerida)':  '201-01 Proveedores',
    }))), 'Compras');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cxc.rows.map(r => ({
      'Cliente':  r.cliente,
      'Monto':    Number(r.monto),
      'Pagado':   Number(r.monto_pagado),
      'Saldo':    Number(r.saldo),
      'Estado':   r.estado,
      'Vence':    fmt(r.fecha_vence),
      'Notas':    r.notas || '',
      'Cta. SAT': '105-01 Clientes',
    }))), 'CxC – Por Cobrar');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cxp.rows.map(r => ({
      'Proveedor':   r.proveedor,
      'Descripción': r.descripcion || '',
      'Total':       Number(r.monto_total),
      'Pagado':      Number(r.monto_pagado),
      'Saldo':       Number(r.saldo),
      'Vence':       fmt(r.fecha_vencimiento),
      'Notas':       r.notas || '',
      'Cta. SAT':    '201-01 Proveedores',
    }))), 'CxP – Por Pagar');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inventario.rows.map(r => ({
      'Nombre':          r.nombre,
      'SKU':             r.sku || '',
      'Unidad':          r.unidad,
      'Precio Venta':    Number(r.precio),
      'Costo Manual':    Number(r.costo   || 0),
      'Costo Prom. PP':  Number(r.costo_promedio || 0),
      'Stock':           r.stock,
      'Valor Inventario': Number((r.costo_promedio || r.costo || 0) * r.stock),
      'Proveedor':       r.proveedor || '',
      'Cta. SAT':        '105-00 Inventario',
    }))), 'Inventario Valorizado');

    const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
    const periodo = `${dDesde.replace(/-/g,'')}_${dHasta.replace(/-/g,'')}`;
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="contpaq_${periodo}.xlsx"`,
    });
    res.send(buf);
  } catch(err) { next(err); }
}

module.exports = { ingresos, clientesTop, cxcVencidas, dashboardCompleto, exportContpaq };
