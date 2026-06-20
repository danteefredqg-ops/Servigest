const db = require('../db/connection');

async function getAll(req, res, next) {
  try {
    const result = await db.query(
      `SELECT g.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
       FROM garantias g
       JOIN clientes c ON c.id = g.cliente_id
       WHERE g.empresa_id = $1
       ORDER BY g.fecha_fin ASC`,
      [req.user.empresa_id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { cliente_id, equipo, num_serie, descripcion, fecha_inicio, meses, notas, ot_id } = req.body;

    if (!cliente_id || !descripcion || !meses) {
      return res.status(400).json({ error: 'cliente_id, descripcion y meses son requeridos' });
    }

    const fecha_ini = fecha_inicio || new Date().toISOString().split('T')[0];
    const fechaFin  = new Date(fecha_ini);
    fechaFin.setMonth(fechaFin.getMonth() + parseInt(meses));
    const fecha_fin = fechaFin.toISOString().split('T')[0];

    const result = await db.query(
      `INSERT INTO garantias
         (empresa_id, cliente_id, ot_id, equipo, num_serie, descripcion, fecha_inicio, fecha_fin, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [req.user.empresa_id, cliente_id, ot_id || null, equipo || null, num_serie || null,
       descripcion, fecha_ini, fecha_fin, notas || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function updateEstado(req, res, next) {
  try {
    const { estado } = req.body;
    const valid = ['activa', 'vencida', 'reclamada', 'anulada'];
    if (!valid.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const result = await db.query(
      `UPDATE garantias SET estado = $1 WHERE id = $2 AND empresa_id = $3 RETURNING *`,
      [estado, req.params.id, req.user.empresa_id]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Garantía no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const result = await db.query(
      'DELETE FROM garantias WHERE id = $1 AND empresa_id = $2 RETURNING id',
      [req.params.id, req.user.empresa_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Garantía no encontrada' });
    res.json({ message: 'Garantía eliminada' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, create, updateEstado, remove };
