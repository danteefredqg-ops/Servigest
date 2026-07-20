const db = require('../db/connection');

async function getAll(req, res, next) {
  try {
    const result = await db.query(
      'SELECT * FROM compras WHERE empresa_id = $1 ORDER BY created_at DESC',
      [req.user.empresa_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { proveedor, descripcion, items, fecha_entrega } = req.body;
    if (!proveedor || !items?.length) {
      return res.status(400).json({ error: 'proveedor e items son requeridos' });
    }
    const total = items.reduce((s, i) => s + (Number(i.cantidad) * Number(i.precio_unit)), 0);
    const result = await db.query(
      `INSERT INTO compras (empresa_id, proveedor, descripcion, items, total, fecha_entrega)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.empresa_id, proveedor, descripcion, JSON.stringify(items), total, fecha_entrega||null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

async function updateEstado(req, res, next) {
  const client = await db.connect();
  try {
    const { estado } = req.body;
    const validos = ['pendiente', 'recibida', 'cancelada'];
    if (!validos.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

    await client.query('BEGIN');

    // AND estado != $1 garantiza idempotencia: si ya tiene ese estado no toca el stock
    const result = await client.query(
      `UPDATE compras SET estado = $1
       WHERE id = $2 AND empresa_id = $3 AND estado != $1
       RETURNING *`,
      [estado, req.params.id, req.user.empresa_id]
    );

    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      // Distinguir "no existe" de "ya tenía ese estado"
      const existe = await db.query(
        'SELECT estado FROM compras WHERE id = $1 AND empresa_id = $2',
        [req.params.id, req.user.empresa_id]
      );
      if (!existe.rows[0]) return res.status(404).json({ error: 'Compra no encontrada' });
      return res.json(existe.rows[0]); // ya tenía ese estado, sin cambios
    }

    if (estado === 'recibida') {
      for (const item of result.rows[0].items) {
        if (item.producto_id) {
          await client.query(
            'UPDATE productos SET stock = stock + $1 WHERE id = $2 AND empresa_id = $3',
            [item.cantidad, item.producto_id, req.user.empresa_id]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

async function adjuntarPDF(req, res, next) {
  try {
    const { archivo_base64, nombre } = req.body;
    if (!archivo_base64) return res.status(400).json({ error: 'archivo_base64 es requerido' });

    const MAX = 7 * 1024 * 1024; // ~5 MB PDF → ~7 MB base64
    if (archivo_base64.length > MAX) return res.status(400).json({ error: 'El PDF no debe superar 5 MB' });

    const result = await db.query(
      `UPDATE compras SET archivo_pdf = $1, archivo_nombre = $2
       WHERE id = $3 AND empresa_id = $4 RETURNING id, archivo_nombre`,
      [archivo_base64, nombre || 'documento.pdf', req.params.id, req.user.empresa_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Compra no encontrada' });
    res.json({ ok: true, nombre: result.rows[0].archivo_nombre });
  } catch(err) { next(err); }
}

async function getPDF(req, res, next) {
  try {
    const result = await db.query(
      'SELECT archivo_pdf, archivo_nombre FROM compras WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.user.empresa_id]
    );
    const row = result.rows[0];
    if (!row || !row.archivo_pdf) return res.status(404).json({ error: 'Sin archivo adjunto' });
    res.json({ archivo_base64: row.archivo_pdf, nombre: row.archivo_nombre });
  } catch(err) { next(err); }
}

async function exportExcel(req, res, next) {
  try {
    const XLSX = require('xlsx');
    const result = await db.query(
      `SELECT proveedor, descripcion, total, estado, fecha_entrega, created_at
       FROM compras WHERE empresa_id = $1 ORDER BY created_at DESC`,
      [req.user.empresa_id]
    );
    const rows = result.rows.map(r => ({
      'Proveedor':   r.proveedor,
      'Descripción': r.descripcion || '',
      'Total ($)':   Number(r.total),
      'Estado':      r.estado,
      'Entrega':     r.fecha_entrega ? new Date(r.fecha_entrega).toLocaleDateString('es-MX') : '',
      'Fecha':       new Date(r.created_at).toLocaleDateString('es-MX'),
    }));
    const ws  = XLSX.utils.json_to_sheet(rows);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Compras');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="compras.xlsx"',
    });
    res.send(buf);
  } catch(err) { next(err); }
}

module.exports = { getAll, create, updateEstado, adjuntarPDF, getPDF, exportExcel };
