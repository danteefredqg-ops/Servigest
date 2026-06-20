const db = require('../db/connection');

async function getAll(req, res, next) {
  try {
    const { search } = req.query;
    const esOperador = req.user.rol === 'operador';

    // Operador no ve precio de costo ni margen — información sensible del negocio
    const campos = esOperador
      ? 'id, empresa_id, nombre, descripcion, sku, unidad, clave_sat, precio, stock, stock_minimo, activo, created_at'
      : '*';

    let query = `SELECT ${campos} FROM productos WHERE empresa_id = $1 AND activo = true`;
    const params = [req.user.empresa_id];

    if (search) {
      query += ` AND (nombre ILIKE $2 OR sku ILIKE $2)`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY nombre ASC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const result = await db.query(
      'SELECT * FROM productos WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.user.empresa_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { nombre, descripcion, sku, unidad, clave_sat, precio, costo, stock, stock_minimo,
            proveedor, fecha_compra } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

    const result = await db.query(
      `INSERT INTO productos
         (empresa_id, nombre, descripcion, sku, unidad, clave_sat, precio, costo, stock, stock_minimo, proveedor, fecha_compra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user.empresa_id, nombre, descripcion, sku, unidad||'servicio', clave_sat||'84111500',
       precio||0, costo||0, stock||0, stock_minimo||0, proveedor||null, fecha_compra||null]
    );

    // Si se registró un costo de compra, guardar en historial
    if (costo && Number(costo) > 0) {
      await db.query(
        `INSERT INTO historial_precios_compra (empresa_id, producto_id, precio, proveedor, fecha)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.user.empresa_id, result.rows[0].id, costo, proveedor||null, fecha_compra||new Date().toISOString().split('T')[0]]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { nombre, descripcion, sku, unidad, clave_sat, precio, costo, stock, stock_minimo,
            proveedor, fecha_compra } = req.body;
    const result = await db.query(
      `UPDATE productos SET
         nombre       = COALESCE($1,  nombre),
         descripcion  = COALESCE($2,  descripcion),
         sku          = COALESCE($3,  sku),
         unidad       = COALESCE($4,  unidad),
         clave_sat    = COALESCE($5,  clave_sat),
         precio       = COALESCE($6,  precio),
         costo        = COALESCE($7,  costo),
         stock        = COALESCE($8,  stock),
         stock_minimo = COALESCE($9,  stock_minimo),
         proveedor    = COALESCE($10, proveedor),
         fecha_compra = COALESCE($11, fecha_compra)
       WHERE id = $12 AND empresa_id = $13 RETURNING *`,
      [nombre, descripcion, sku, unidad, clave_sat, precio, costo, stock, stock_minimo,
       proveedor, fecha_compra || null,
       req.params.id, req.user.empresa_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

// ── Historial precios de compra ───────────────────────────────────────────────
async function getHistorialPrecios(req, res, next) {
  try {
    const result = await db.query(
      `SELECT h.* FROM historial_precios_compra h
       JOIN productos p ON p.id = h.producto_id
       WHERE h.producto_id = $1 AND h.empresa_id = $2
       ORDER BY h.fecha DESC, h.created_at DESC`,
      [req.params.id, req.user.empresa_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

async function addPrecioCompra(req, res, next) {
  try {
    const { precio, proveedor, fecha, notas } = req.body;
    if (!precio || Number(precio) <= 0) return res.status(400).json({ error: 'Precio inválido' });

    const result = await db.query(
      `INSERT INTO historial_precios_compra (empresa_id, producto_id, precio, proveedor, fecha, notas)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.empresa_id, req.params.id, precio, proveedor||null,
       fecha || new Date().toISOString().split('T')[0], notas||null]
    );

    // Actualizar costo actual del producto con el nuevo precio
    await db.query(
      'UPDATE productos SET costo = $1, proveedor = COALESCE($2, proveedor), fecha_compra = $3 WHERE id = $4 AND empresa_id = $5',
      [precio, proveedor||null, fecha||new Date().toISOString().split('T')[0], req.params.id, req.user.empresa_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    // Soft delete — no borrar si tiene pedidos
    const result = await db.query(
      'UPDATE productos SET activo = false WHERE id = $1 AND empresa_id = $2 RETURNING id',
      [req.params.id, req.user.empresa_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ message: 'Producto eliminado' });
  } catch (err) { next(err); }
}

// Alerta de stock bajo
async function stockBajo(req, res, next) {
  try {
    const result = await db.query(
      `SELECT * FROM productos
       WHERE empresa_id = $1 AND activo = true AND stock <= stock_minimo AND stock_minimo > 0
       ORDER BY stock ASC`,
      [req.user.empresa_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

module.exports = { getAll, getById, create, update, remove, stockBajo, getHistorialPrecios, addPrecioCompra };
