const { log } = require('../middleware/audit');
const db = require('../db/connection');

// ── Listar pedidos ────────────────────────────────────────────────────────────
async function getAll(req, res, next) {
  try {
    const { estado, desde, hasta, cliente_id } = req.query;
    const empresa_id = req.user.empresa_id;

    let query = `
      SELECT p.id, p.numero, p.descripcion, p.subtotal, p.impuestos, p.total,
             p.estado, p.fecha_servicio, p.notas, p.created_at,
             c.nombre    AS cliente_nombre,
             c.telefono  AS cliente_telefono,
             c.rfc       AS cliente_rfc,
             (SELECT COUNT(*) FROM pedido_items pi WHERE pi.pedido_id = p.id) AS num_items
      FROM pedidos p
      JOIN clientes c ON c.id = p.cliente_id
      WHERE p.empresa_id = $1
    `;
    const params = [empresa_id];
    let idx = 2;

    if (estado)     { query += ` AND p.estado = $${idx++}`;      params.push(estado); }
    if (desde)      { query += ` AND p.created_at >= $${idx++}`; params.push(desde); }
    if (hasta)      { query += ` AND p.created_at <= $${idx++}`; params.push(hasta); }
    if (cliente_id) { query += ` AND p.cliente_id = $${idx++}`;  params.push(cliente_id); }

    query += ' ORDER BY p.created_at DESC';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) { next(err); }
}

// ── Detalle de un pedido con sus items ────────────────────────────────────────
async function getById(req, res, next) {
  try {
    const pedido = await db.query(
      `SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
              c.rfc AS cliente_rfc, c.email AS cliente_email,
              c.direccion AS cliente_direccion
       FROM pedidos p
       JOIN clientes c ON c.id = p.cliente_id
       WHERE p.id = $1 AND p.empresa_id = $2`,
      [req.params.id, req.user.empresa_id]
    );

    if (!pedido.rows[0]) return res.status(404).json({ error: 'Pedido no encontrado' });

    // Cargar items del pedido
    const items = await db.query(
      `SELECT pi.*, pr.nombre AS producto_nombre, pr.sku, pr.unidad
       FROM pedido_items pi
       LEFT JOIN productos pr ON pr.id = pi.producto_id
       WHERE pi.pedido_id = $1
       ORDER BY pi.id`,
      [req.params.id]
    );

    res.json({ ...pedido.rows[0], items: items.rows });
  } catch (err) { next(err); }
}

// ── Crear pedido con items detallados ─────────────────────────────────────────
async function create(req, res, next) {
  const client = await db.connect(); // transacción
  try {
    const {
      cliente_id, descripcion, fecha_servicio, notas,
      items = [],   // [{ producto_id, descripcion, cantidad, precio_unit, descuento }]
      iva = true,   // aplicar IVA 16% por defecto
      forma_pago = 'por_definir',
    } = req.body;

    if (!cliente_id) return res.status(400).json({ error: 'cliente_id es requerido' });
    if (!items.length) return res.status(400).json({ error: 'Agrega al menos un producto o servicio' });

    const clienteCheck = await db.query(
      'SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2',
      [cliente_id, req.user.empresa_id]
    );
    if (!clienteCheck.rows[0]) return res.status(400).json({ error: 'Cliente no válido' });

    await client.query('BEGIN');

    // Calcular totales desde los items
    let subtotal = 0;
    const itemsValidos = items.map(item => {
      const cantidad    = Number(item.cantidad)    || 1;
      const precio_unit = Number(item.precio_unit) || 0;
      const descuento   = Math.min(Number(item.descuento) || 0, 100); // % máx 100
      const sub         = cantidad * precio_unit * (1 - descuento / 100);
      subtotal += sub;
      return { ...item, cantidad, precio_unit, descuento, subtotal: sub };
    });

    const impuestos = iva ? subtotal * 0.16 : 0;
    const total     = subtotal + impuestos;

    // Insertar pedido
    const pedidoRes = await client.query(
      `INSERT INTO pedidos
         (empresa_id, cliente_id, descripcion, subtotal, impuestos, total, fecha_servicio, notas, forma_pago)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [req.user.empresa_id, cliente_id, descripcion, subtotal, impuestos, total,
       fecha_servicio || null, notas || null, forma_pago]
    );
    const pedido = pedidoRes.rows[0];

    // Insertar items
    for (const item of itemsValidos) {
      await client.query(
        `INSERT INTO pedido_items
           (pedido_id, producto_id, descripcion, cantidad, precio_unit, descuento, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pedido.id, item.producto_id || null, item.descripcion,
         item.cantidad, item.precio_unit, item.descuento, item.subtotal]
      );

      // Descontar stock si tiene producto vinculado
      if (item.producto_id) {
        await client.query(
          'UPDATE productos SET stock = stock - $1 WHERE id = $2 AND empresa_id = $3 AND stock >= $1',
          [item.cantidad, item.producto_id, req.user.empresa_id]
        );
      }
    }

    await client.query('COMMIT');

    await log(req, 'crear_pedido', 'pedido', pedido.id, {
      total, cliente_id, num_items: itemsValidos.length,
    });

    res.status(201).json({ ...pedido, items: itemsValidos });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// ── Actualizar estado / notas (sin tocar items) ───────────────────────────────
async function update(req, res, next) {
  try {
    const { descripcion, estado, fecha_servicio, notas } = req.body;

    const result = await db.query(
      `UPDATE pedidos
       SET descripcion    = COALESCE($1, descripcion),
           estado         = COALESCE($2, estado),
           fecha_servicio = COALESCE($3, fecha_servicio),
           notas          = COALESCE($4, notas)
       WHERE id = $5 AND empresa_id = $6
       RETURNING *`,
      [descripcion, estado, fecha_servicio, notas, req.params.id, req.user.empresa_id]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Pedido no encontrado' });

    // Loggear cambio de estado específicamente
    if (estado) {
      await log(req, `cambiar_estado_pedido`, 'pedido', req.params.id, { estado });
    }

    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

// ── Eliminar pedido (devuelve stock) ──────────────────────────────────────────
async function remove(req, res, next) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Recuperar items para devolver stock
    const items = await client.query(
      'SELECT * FROM pedido_items WHERE pedido_id = $1',
      [req.params.id]
    );

    for (const item of items.rows) {
      if (item.producto_id) {
        await client.query(
          'UPDATE productos SET stock = stock + $1 WHERE id = $2 AND empresa_id = $3',
          [item.cantidad, item.producto_id, req.user.empresa_id]
        );
      }
    }

    const result = await client.query(
      'DELETE FROM pedidos WHERE id = $1 AND empresa_id = $2 RETURNING id',
      [req.params.id, req.user.empresa_id]
    );

    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    await client.query('COMMIT');
    await log(req, 'eliminar_pedido', 'pedido', req.params.id, {});
    res.json({ message: 'Pedido eliminado' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// ── Resumen dashboard ─────────────────────────────────────────────────────────
async function getSummary(req, res, next) {
  try {
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE estado = 'pendiente')  AS pendientes,
         COUNT(*) FILTER (WHERE estado = 'en_camino')  AS en_camino,
         COUNT(*) FILTER (WHERE estado = 'entregado')  AS entregados,
         COUNT(*) FILTER (WHERE estado = 'cancelado')  AS cancelados,
         COALESCE(SUM(total) FILTER (
           WHERE estado = 'entregado' AND created_at >= date_trunc('day', NOW())
         ), 0) AS cobrado_hoy,
         COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW())) AS pedidos_hoy,
         COALESCE(SUM(total) FILTER (
           WHERE estado = 'entregado' AND created_at >= date_trunc('month', NOW())
         ), 0) AS cobrado_mes
       FROM pedidos WHERE empresa_id = $1`,
      [req.user.empresa_id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

module.exports = { getAll, getById, create, update, remove, getSummary };
