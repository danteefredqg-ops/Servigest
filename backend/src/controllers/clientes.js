const db = require('../db/connection');

async function getAll(req, res, next) {
  try {
    const result = await db.query(
      `SELECT c.*,
              COUNT(p.id) AS total_pedidos,
              COALESCE(SUM(p.total) FILTER (WHERE p.estado = 'entregado'), 0) AS total_facturado
       FROM clientes c
       LEFT JOIN pedidos p ON p.cliente_id = c.id AND p.empresa_id = c.empresa_id
       WHERE c.empresa_id = $1
       GROUP BY c.id
       ORDER BY c.nombre ASC`,
      [req.user.empresa_id]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const cliente = await db.query(
      'SELECT * FROM clientes WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.user.empresa_id]
    );

    if (!cliente.rows[0]) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Últimos pedidos del cliente (filtrado por empresa para seguridad)
    const pedidos = await db.query(
      `SELECT p.*
       FROM pedidos p
       WHERE p.cliente_id = $1 AND p.empresa_id = $2
       ORDER BY p.created_at DESC LIMIT 10`,
      [req.params.id, req.user.empresa_id]
    );

    res.json({ ...cliente.rows[0], pedidos: pedidos.rows });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { nombre, telefono, email, direccion, rfc, uso_cfdi, regimen_fiscal, cp, notas } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    const result = await db.query(
      `INSERT INTO clientes
         (nombre, telefono, email, direccion, rfc, uso_cfdi, regimen_fiscal, cp, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [nombre, telefono||null, email||null, direccion||null,
       rfc ? rfc.toUpperCase() : null,
       uso_cfdi||'G03', regimen_fiscal||null, cp||null, notas||null,
       req.user.empresa_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { nombre, telefono, email, direccion, rfc, uso_cfdi, regimen_fiscal, cp, notas } = req.body;

    const result = await db.query(
      `UPDATE clientes
       SET nombre         = COALESCE($1,  nombre),
           telefono       = COALESCE($2,  telefono),
           email          = COALESCE($3,  email),
           direccion      = COALESCE($4,  direccion),
           rfc            = COALESCE($5,  rfc),
           uso_cfdi       = COALESCE($6,  uso_cfdi),
           regimen_fiscal = COALESCE($7,  regimen_fiscal),
           cp             = COALESCE($8,  cp),
           notas          = COALESCE($9,  notas)
       WHERE id = $10 AND empresa_id = $11
       RETURNING *`,
      [nombre, telefono||null, email||null, direccion||null,
       rfc ? rfc.toUpperCase() : null,
       uso_cfdi||null, regimen_fiscal||null, cp||null, notas||null,
       req.params.id, req.user.empresa_id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const result = await db.query(
      'DELETE FROM clientes WHERE id = $1 AND empresa_id = $2 RETURNING id',
      [req.params.id, req.user.empresa_id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    res.json({ message: 'Cliente eliminado' });
  } catch (err) {
    next(err);
  }
}

async function exportExcel(req, res, next) {
  try {
    const XLSX = require('xlsx');
    const result = await db.query(
      `SELECT c.nombre, c.telefono, c.email, c.direccion, c.rfc,
              COUNT(p.id) AS total_pedidos,
              COALESCE(SUM(p.total) FILTER (WHERE p.estado='entregado'), 0) AS total_facturado
       FROM clientes c
       LEFT JOIN pedidos p ON p.cliente_id = c.id AND p.empresa_id = c.empresa_id
       WHERE c.empresa_id = $1
       GROUP BY c.id ORDER BY c.nombre ASC`,
      [req.user.empresa_id]
    );
    const rows = result.rows.map(r => ({
      Nombre:           r.nombre,
      Teléfono:         r.telefono || '',
      Email:            r.email    || '',
      Dirección:        r.direccion || '',
      RFC:              r.rfc      || '',
      'Total Pedidos':  Number(r.total_pedidos),
      'Total Facturado': Number(r.total_facturado),
    }));
    const ws  = XLSX.utils.json_to_sheet(rows);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'Content-Disposition': 'attachment; filename="clientes.xlsx"' });
    res.send(buf);
  } catch(err) { next(err); }
}

module.exports = { getAll, getById, create, update, remove, exportExcel };
