const db = require('../db/connection');

const BASE_SELECT = `
  SELECT *,
    monto_total - monto_pagado AS saldo,
    CASE
      WHEN monto_pagado >= monto_total                                          THEN 'pagada'
      WHEN monto_pagado > 0                                                     THEN 'parcial'
      WHEN fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURRENT_DATE   THEN 'vencida'
      ELSE 'pendiente'
    END AS estado
  FROM cuentas_por_pagar
  WHERE empresa_id = $1
`;

async function getAll(req, res, next) {
  try {
    const { estado } = req.query;
    const params = [req.user.empresa_id];
    let q = `SELECT * FROM (${BASE_SELECT}) t`;
    if (estado) { q += ' WHERE t.estado = $2'; params.push(estado); }
    q += ' ORDER BY t.fecha_vencimiento ASC NULLS LAST, t.created_at DESC';
    const result = await db.query(q, params);
    res.json(result.rows);
  } catch (err) { next(err); }
}

async function getResumen(req, res, next) {
  try {
    const result = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN estado IN ('pendiente','parcial') THEN saldo END), 0) AS total_adeudado,
        COALESCE(SUM(CASE WHEN estado = 'vencida'                THEN saldo END), 0) AS total_vencido,
        COALESCE(SUM(CASE WHEN estado IN ('pendiente','parcial')
          AND fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 7        THEN saldo END), 0) AS por_vencer_7d,
        COUNT(*) FILTER (WHERE estado NOT IN ('pagada'))                                           AS abiertas
      FROM (${BASE_SELECT}) t
    `, [req.user.empresa_id]);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { proveedor, descripcion, compra_id, monto_total, fecha_vencimiento, notas } = req.body;
    if (!proveedor || !monto_total || Number(monto_total) <= 0) {
      return res.status(400).json({ error: 'proveedor y monto_total son requeridos' });
    }
    const result = await db.query(
      `INSERT INTO cuentas_por_pagar
         (empresa_id, proveedor, descripcion, compra_id, monto_total, fecha_vencimiento, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.empresa_id, proveedor, descripcion || null,
       compra_id || null, monto_total, fecha_vencimiento || null, notas || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

async function registrarPago(req, res, next) {
  const client = await db.connect();
  try {
    const { monto, notas } = req.body;
    if (!monto || Number(monto) <= 0) {
      return res.status(400).json({ error: 'monto debe ser mayor a cero' });
    }
    await client.query('BEGIN');

    const cxpRes = await client.query(
      'SELECT * FROM cuentas_por_pagar WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
      [req.params.id, req.user.empresa_id]
    );
    const cxp = cxpRes.rows[0];
    if (!cxp) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'CxP no encontrada' }); }

    const saldo = Number(cxp.monto_total) - Number(cxp.monto_pagado);
    if (saldo <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La cuenta ya está pagada' }); }

    const montoPago = Math.min(Number(monto), saldo);

    await client.query(
      'INSERT INTO pagos_cxp (cxp_id, empresa_id, monto, notas) VALUES ($1,$2,$3,$4)',
      [cxp.id, req.user.empresa_id, montoPago, notas || null]
    );
    const updRes = await client.query(
      'UPDATE cuentas_por_pagar SET monto_pagado = monto_pagado + $1 WHERE id = $2 RETURNING *',
      [montoPago, cxp.id]
    );

    await client.query('COMMIT');
    res.json({ ...updRes.rows[0], monto_aplicado: montoPago });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

async function getHistorial(req, res, next) {
  try {
    const cxp = await db.query(
      'SELECT id FROM cuentas_por_pagar WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.user.empresa_id]
    );
    if (!cxp.rows[0]) return res.status(404).json({ error: 'CxP no encontrada' });
    const result = await db.query(
      'SELECT * FROM pagos_cxp WHERE cxp_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const cxp = await db.query(
      'SELECT id FROM cuentas_por_pagar WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.user.empresa_id]
    );
    if (!cxp.rows[0]) return res.status(404).json({ error: 'CxP no encontrada' });

    const pagos = await db.query(
      'SELECT COUNT(*) FROM pagos_cxp WHERE cxp_id = $1', [req.params.id]
    );
    if (Number(pagos.rows[0].count) > 0) {
      return res.status(400).json({ error: 'No se puede eliminar una CxP con pagos registrados' });
    }
    await db.query('DELETE FROM cuentas_por_pagar WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { getAll, getResumen, create, registrarPago, getHistorial, remove };
