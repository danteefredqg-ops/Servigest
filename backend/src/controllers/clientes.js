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
    const { nombre, telefono, email, direccion } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    const result = await db.query(
      `INSERT INTO clientes (nombre, telefono, email, direccion, empresa_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre, telefono, email, direccion, req.user.empresa_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { nombre, telefono, email, direccion } = req.body;

    const result = await db.query(
      `UPDATE clientes
       SET nombre    = COALESCE($1, nombre),
           telefono  = COALESCE($2, telefono),
           email     = COALESCE($3, email),
           direccion = COALESCE($4, direccion)
       WHERE id = $5 AND empresa_id = $6
       RETURNING *`,
      [nombre, telefono, email, direccion, req.params.id, req.user.empresa_id]
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

module.exports = { getAll, getById, create, update, remove };
