const db = require('../db/connection');

async function getAll(req, res, next) {
  try {
    const result = await db.query(
      `SELECT co.id, co.items, co.total, co.estado, co.created_at,
              c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
       FROM cotizaciones co
       JOIN clientes c ON c.id = co.cliente_id
       WHERE co.empresa_id = $1
       ORDER BY co.created_at DESC`,
      [req.user.empresa_id]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const result = await db.query(
      `SELECT co.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
              c.email AS cliente_email, c.direccion AS cliente_direccion,
              e.nombre AS empresa_nombre
       FROM cotizaciones co
       JOIN clientes c ON c.id = co.cliente_id
       JOIN empresas e ON e.id = co.empresa_id
       WHERE co.id = $1 AND co.empresa_id = $2`,
      [req.params.id, req.user.empresa_id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { cliente_id, items } = req.body;

    if (!cliente_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'cliente_id e items son requeridos' });
    }

    // Calcular total desde los items para no confiar en el cliente
    const total = items.reduce((sum, item) => {
      return sum + (Number(item.cantidad) * Number(item.precio_unitario));
    }, 0);

    const itemsConSubtotal = items.map(item => ({
      ...item,
      subtotal: Number(item.cantidad) * Number(item.precio_unitario),
    }));

    const { ot_id, notas, valida_hasta } = req.body;

    const result = await db.query(
      `INSERT INTO cotizaciones (cliente_id, items, total, empresa_id, ot_id, notas, valida_hasta)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [cliente_id, JSON.stringify(itemsConSubtotal), total, req.user.empresa_id,
       ot_id || null, notas || null, valida_hasta || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function updateEstado(req, res, next) {
  try {
    const { estado } = req.body;
    const estadosValidos = ['borrador', 'enviada', 'aceptada', 'rechazada'];

    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const result = await db.query(
      `UPDATE cotizaciones SET estado = $1
       WHERE id = $2 AND empresa_id = $3 RETURNING *`,
      [estado, req.params.id, req.user.empresa_id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const result = await db.query(
      'DELETE FROM cotizaciones WHERE id = $1 AND empresa_id = $2 RETURNING id',
      [req.params.id, req.user.empresa_id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    res.json({ message: 'Cotización eliminada' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getById, create, updateEstado, remove };
