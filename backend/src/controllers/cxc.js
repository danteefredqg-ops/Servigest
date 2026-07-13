const db = require('../db/connection');

async function getAll(req, res, next) {
  try {
    const { estado } = req.query;
    let q = `
      SELECT cxc.*, c.nombre AS cliente_nombre, c.telefono AS cliente_tel
      FROM cuentas_por_cobrar cxc
      JOIN clientes c ON c.id = cxc.cliente_id
      WHERE cxc.empresa_id = $1
    `;
    const params = [req.user.empresa_id];
    if (estado) { q += ' AND cxc.estado = $2'; params.push(estado); }
    q += ' ORDER BY cxc.fecha_vence ASC';

    const result = await db.query(q, params);
    res.json(result.rows);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { cliente_id, pedido_id, factura_id, monto, fecha_vence, notas } = req.body;
    if (!cliente_id || !monto || !fecha_vence) {
      return res.status(400).json({ error: 'cliente_id, monto y fecha_vence son requeridos' });
    }

    const clienteCheck = await db.query(
      'SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2',
      [cliente_id, req.user.empresa_id]
    );
    if (!clienteCheck.rows[0]) return res.status(400).json({ error: 'Cliente no válido' });

    const result = await db.query(
      `INSERT INTO cuentas_por_cobrar (empresa_id, cliente_id, pedido_id, factura_id, monto, fecha_vence, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.empresa_id, cliente_id, pedido_id||null, factura_id||null, monto, fecha_vence, notas]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

// Registrar pago parcial o total
async function registrarPago(req, res, next) {
  const client = await db.connect();
  try {
    const { monto, metodo, referencia, fecha, notas } = req.body;
    if (!monto || Number(monto) <= 0) {
      return res.status(400).json({ error: 'monto es requerido y debe ser mayor a cero' });
    }

    await client.query('BEGIN');

    // FOR UPDATE bloquea la fila para evitar race conditions en pagos concurrentes
    const cxcRes = await client.query(
      'SELECT * FROM cuentas_por_cobrar WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
      [req.params.id, req.user.empresa_id]
    );
    const cxc = cxcRes.rows[0];
    if (!cxc) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'CxC no encontrada' });
    }

    await client.query(
      `INSERT INTO pagos_cxc (cxc_id, monto, metodo, referencia, fecha, notas)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [cxc.id, monto, metodo || 'efectivo', referencia, fecha || new Date(), notas]
    );

    const nuevoPagado = Number(cxc.monto_pagado) + Number(monto);
    const nuevoEstado = nuevoPagado >= Number(cxc.monto) ? 'pagada' : 'parcial';

    await client.query(
      'UPDATE cuentas_por_cobrar SET monto_pagado = $1, estado = $2 WHERE id = $3',
      [nuevoPagado, nuevoEstado, cxc.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Pago registrado', estado: nuevoEstado, monto_pagado: nuevoPagado });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

// Resumen de CxC para dashboard
async function resumen(req, res, next) {
  try {
    const result = await db.query(
      `SELECT
         COALESCE(SUM(monto - monto_pagado) FILTER (WHERE estado IN ('pendiente','parcial')), 0) AS por_cobrar,
         COALESCE(SUM(monto - monto_pagado) FILTER (WHERE estado = 'vencida'), 0) AS vencido,
         COUNT(*) FILTER (WHERE estado = 'vencida') AS cuentas_vencidas,
         COUNT(*) FILTER (WHERE estado IN ('pendiente','parcial')) AS cuentas_vigentes
       FROM cuentas_por_cobrar WHERE empresa_id = $1`,
      [req.user.empresa_id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

module.exports = { getAll, create, registrarPago, resumen };
