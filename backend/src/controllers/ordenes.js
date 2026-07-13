const { log } = require('../middleware/audit');
const db = require('../db/connection');

// ── Listar OTs ────────────────────────────────────────────────────────────────
async function getAll(req, res, next) {
  try {
    const { estado, tecnico_id, prioridad } = req.query;
    const empresa_id = req.user.empresa_id;
    const esOperador = req.user.rol === 'operador';

    let query = `
      SELECT ot.id, ot.numero, ot.descripcion, ot.equipo, ot.num_serie,
             ot.estado, ot.prioridad, ot.fecha_prometida, ot.total,
             ot.created_at, ot.updated_at,
             c.nombre   AS cliente_nombre,
             c.telefono AS cliente_telefono,
             u.nombre   AS tecnico_nombre,
             (SELECT COUNT(*) FROM ot_items i WHERE i.ot_id = ot.id) AS num_items,
             (SELECT COUNT(*) FROM ot_items i WHERE i.ot_id = ot.id AND i.disponible = false) AS items_faltantes,
             (SELECT COUNT(*) FROM alertas a WHERE a.ot_id = ot.id AND a.resuelta = false) AS alertas_abiertas
      FROM ordenes_trabajo ot
      JOIN clientes c ON c.id = ot.cliente_id
      LEFT JOIN usuarios u ON u.id = ot.tecnico_id
      WHERE ot.empresa_id = $1
    `;
    const params = [empresa_id];
    let idx = 2;

    // Operador solo ve sus OTs asignadas
    if (esOperador) {
      query += ` AND ot.tecnico_id = $${idx++}`;
      params.push(req.user.id);
    }

    if (estado)     { query += ` AND ot.estado = $${idx++}`;      params.push(estado); }
    if (tecnico_id) { query += ` AND ot.tecnico_id = $${idx++}`;  params.push(tecnico_id); }
    if (prioridad)  { query += ` AND ot.prioridad = $${idx++}`;   params.push(prioridad); }

    query += ' ORDER BY ot.updated_at DESC';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch(err) { next(err); }
}

// ── Detalle completo de una OT ────────────────────────────────────────────────
async function getById(req, res, next) {
  try {
    const ot = await db.query(
      `SELECT ot.*,
              c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
              c.email AS cliente_email, c.rfc AS cliente_rfc,
              u.nombre AS tecnico_nombre, u.email AS tecnico_email
       FROM ordenes_trabajo ot
       JOIN clientes c ON c.id = ot.cliente_id
       LEFT JOIN usuarios u ON u.id = ot.tecnico_id
       WHERE ot.id = $1 AND ot.empresa_id = $2`,
      [req.params.id, req.user.empresa_id]
    );

    if (!ot.rows[0]) return res.status(404).json({ error: 'Orden no encontrada' });

    const items = await db.query(
      `SELECT i.*, p.nombre AS producto_nombre, p.sku, p.stock AS stock_actual
       FROM ot_items i
       LEFT JOIN productos p ON p.id = i.producto_id
       WHERE i.ot_id = $1 ORDER BY i.tipo, i.id`,
      [req.params.id]
    );

    const alertas = await db.query(
      `SELECT a.*, u.nombre AS de_usuario_nombre
       FROM alertas a
       LEFT JOIN usuarios u ON u.id = a.de_usuario_id
       WHERE a.ot_id = $1 ORDER BY a.created_at DESC`,
      [req.params.id]
    );

    res.json({
      ...ot.rows[0],
      items:   items.rows,
      alertas: alertas.rows,
    });
  } catch(err) { next(err); }
}

// ── Crear OT ──────────────────────────────────────────────────────────────────
async function create(req, res, next) {
  const client = await db.connect();
  try {
    const {
      cliente_id, descripcion, equipo, num_serie,
      tecnico_id, prioridad = 'normal', fecha_prometida,
      items = [],
    } = req.body;

    if (!cliente_id || !descripcion) {
      return res.status(400).json({ error: 'cliente_id y descripcion son requeridos' });
    }

    const clienteCheck = await db.query(
      'SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2',
      [cliente_id, req.user.empresa_id]
    );
    if (!clienteCheck.rows[0]) return res.status(400).json({ error: 'Cliente no válido' });

    await client.query('BEGIN');

    // Calcular totales — consumibles NO se facturan al cliente
    let subtotal = 0;
    const itemsProc = items.map(item => {
      const cantidad    = Number(item.cantidad)    || 1;
      const precio_unit = Number(item.precio_unit) || 0;
      const costo_unit  = Number(item.costo_unit)  || 0;
      const facturar    = item.tipo !== 'consumible'; // consumibles no facturan
      const sub         = facturar ? cantidad * precio_unit : 0;
      subtotal += sub;
      return { ...item, cantidad, precio_unit, costo_unit, subtotal: sub, facturar };
    });

    const impuestos = subtotal * 0.16;
    const total     = subtotal + impuestos;

    const otRes = await client.query(
      `INSERT INTO ordenes_trabajo
         (empresa_id, cliente_id, tecnico_id, descripcion, equipo, num_serie,
          prioridad, fecha_prometida, subtotal, impuestos, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [req.user.empresa_id, cliente_id, tecnico_id || null, descripcion,
       equipo || null, num_serie || null, prioridad, fecha_prometida || null,
       subtotal, impuestos, total]
    );
    const ot = otRes.rows[0];

    // Insertar items y verificar/descontar stock
    for (const item of itemsProc) {
      let disponible = true;

      if (item.producto_id && item.tipo === 'refaccion') {
        // UPDATE condicional atómico: descuenta solo si hay stock suficiente
        const stockRes = await client.query(
          `UPDATE productos SET stock = stock - $1
           WHERE id = $2 AND empresa_id = $3 AND stock >= $1
           RETURNING stock`,
          [item.cantidad, item.producto_id, req.user.empresa_id]
        );
        disponible = stockRes.rowCount > 0;
      } else if (item.producto_id && item.tipo === 'consumible') {
        // Consumibles: verificar existencia sin descontar (costo interno)
        const prod = await client.query(
          'SELECT stock FROM productos WHERE id = $1 AND empresa_id = $2',
          [item.producto_id, req.user.empresa_id]
        );
        disponible = prod.rows[0] ? Number(prod.rows[0].stock) >= item.cantidad : false;
      }

      await client.query(
        `INSERT INTO ot_items
           (ot_id, producto_id, tipo, descripcion, cantidad,
            precio_unit, costo_unit, subtotal, facturar, disponible)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [ot.id, item.producto_id || null, item.tipo || 'refaccion',
         item.descripcion, item.cantidad, item.precio_unit,
         item.costo_unit, item.subtotal, item.facturar, disponible]
      );
    }

    // Crear alerta si hay items sin stock
    const faltantes = itemsProc.filter(i => !i.disponible && i.tipo !== 'mano_obra');
    if (faltantes.length) {
      await client.query(
        `INSERT INTO alertas (empresa_id, ot_id, de_usuario_id, para_rol, tipo, titulo, mensaje)
         VALUES ($1,$2,$3,'admin','falta_pieza',$4,$5)`,
        [req.user.empresa_id, ot.id, req.user.id,
         `OT #${String(ot.numero).padStart(4,'0')} — Faltan ${faltantes.length} pieza(s)`,
         `Piezas sin stock: ${faltantes.map(f=>f.descripcion).join(', ')}`]
      );
    }

    await client.query('COMMIT');
    await log(req, 'crear_ot', 'orden_trabajo', ot.id, { cliente_id, total });

    res.status(201).json({ ...ot, items: itemsProc });
  } catch(err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// ── Cambiar estado de la OT ───────────────────────────────────────────────────
async function cambiarEstado(req, res, next) {
  const client = await db.connect();
  try {
    const { estado, notas_tecnico, notas_entrega } = req.body;
    const estadosValidos = ['recibida','en_proceso','en_espera','terminada','entregada','cancelada'];

    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    await client.query('BEGIN');

    const otRes = await client.query(
      'SELECT * FROM ordenes_trabajo WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.user.empresa_id]
    );
    if (!otRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    const ot = otRes.rows[0];

    await client.query(
      `UPDATE ordenes_trabajo
       SET estado         = $1,
           notas_tecnico  = COALESCE($2, notas_tecnico),
           notas_entrega  = COALESCE($3, notas_entrega),
           updated_at     = NOW()
       WHERE id = $4`,
      [estado, notas_tecnico || null, notas_entrega || null, req.params.id]
    );

    // Si el técnico pone en_espera → crear alerta de falta de pieza
    if (estado === 'en_espera') {
      await client.query(
        `INSERT INTO alertas (empresa_id, ot_id, de_usuario_id, para_rol, tipo, titulo, mensaje)
         VALUES ($1,$2,$3,'admin','falta_pieza',$4,$5)`,
        [req.user.empresa_id, req.params.id, req.user.id,
         `OT #${String(ot.numero).padStart(4,'0')} — En espera de material`,
         notas_tecnico || 'El técnico reporta que falta material para continuar']
      );
    }

    // Si se marca terminada → notificar a admin/recepcionista
    if (estado === 'terminada') {
      await client.query(
        `INSERT INTO alertas (empresa_id, ot_id, de_usuario_id, para_rol, tipo, titulo, mensaje)
         VALUES ($1,$2,$3,'admin','completado',$4,$5)`,
        [req.user.empresa_id, req.params.id, req.user.id,
         `OT #${String(ot.numero).padStart(4,'0')} — Lista para entregar`,
         notas_entrega || 'El técnico marcó la orden como terminada']
      );
    }

    await client.query('COMMIT');
    await log(req, `cambiar_estado_ot`, 'orden_trabajo', req.params.id, { estado });

    res.json({ message: 'Estado actualizado', estado });
  } catch(err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// ── Solicitar pieza faltante ──────────────────────────────────────────────────
async function solicitarPieza(req, res, next) {
  try {
    const { descripcion, cantidad, urgente = false } = req.body;
    if (!descripcion) return res.status(400).json({ error: 'descripcion es requerida' });

    const ot = await db.query(
      'SELECT numero FROM ordenes_trabajo WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.user.empresa_id]
    );
    if (!ot.rows[0]) return res.status(404).json({ error: 'Orden no encontrada' });

    // Agregar item faltante a la OT
    await db.query(
      `INSERT INTO ot_items (ot_id, tipo, descripcion, cantidad, precio_unit, subtotal, disponible)
       VALUES ($1,'refaccion',$2,$3,0,0,false)`,
      [req.params.id, descripcion, cantidad || 1]
    );

    // Crear alerta
    await db.query(
      `INSERT INTO alertas (empresa_id, ot_id, de_usuario_id, para_rol, tipo, titulo, mensaje)
       VALUES ($1,$2,$3,'admin','falta_pieza',$4,$5)`,
      [req.user.empresa_id, req.params.id, req.user.id,
       `${urgente ? '🚨 URGENTE — ' : ''}OT #${String(ot.rows[0].numero).padStart(4,'0')} — Solicitud de material`,
       `Se necesita: ${descripcion} (cantidad: ${cantidad || 1})`]
    );

    // Poner OT en espera automáticamente
    await db.query(
      "UPDATE ordenes_trabajo SET estado = 'en_espera', updated_at = NOW() WHERE id = $1",
      [req.params.id]
    );

    res.json({ message: 'Solicitud enviada. La OT está en espera.' });
  } catch(err) { next(err); }
}

// ── Marcar pieza como disponible (admin la compró) ────────────────────────────
async function marcarPiezaDisponible(req, res, next) {
  const client = await db.connect();
  try {
    const { item_id } = req.body;

    await client.query('BEGIN');

    // Marcar item como disponible — verifica que pertenezca a esta OT y empresa
    const itemRes = await client.query(
      `UPDATE ot_items oi SET disponible = true
       FROM ordenes_trabajo ot
       WHERE oi.id = $1
         AND oi.ot_id = $2
         AND ot.id = oi.ot_id
         AND ot.empresa_id = $3
       RETURNING oi.*`,
      [item_id, req.params.id, req.user.empresa_id]
    );
    if (!itemRes.rows[0]) return res.status(404).json({ error: 'Item no encontrado' });

    const item = itemRes.rows[0];

    // Si ya no hay items faltantes → quitar estado en_espera
    const faltantes = await client.query(
      'SELECT COUNT(*) FROM ot_items WHERE ot_id = $1 AND disponible = false',
      [req.params.id]
    );

    if (Number(faltantes.rows[0].count) === 0) {
      await client.query(
        "UPDATE ordenes_trabajo SET estado = 'en_proceso', updated_at = NOW() WHERE id = $1 AND estado = 'en_espera'",
        [req.params.id]
      );

      // Notificar al técnico que ya puede continuar
      const ot = await client.query('SELECT numero, tecnico_id FROM ordenes_trabajo WHERE id = $1', [req.params.id]);
      if (ot.rows[0]?.tecnico_id) {
        await client.query(
          `INSERT INTO alertas (empresa_id, ot_id, de_usuario_id, para_rol, tipo, titulo, mensaje)
           VALUES ($1,$2,$3,'operador','info',$4,$5)`,
          [req.user.empresa_id, req.params.id, req.user.id,
           `OT #${String(ot.rows[0].numero).padStart(4,'0')} — Material disponible`,
           `Ya llegaron todos los materiales. Puedes continuar con la reparación.`]
        );
      }
    }

    // Resolver alertas de falta_pieza de esta OT
    await client.query(
      "UPDATE alertas SET resuelta = true WHERE ot_id = $1 AND tipo = 'falta_pieza' AND resuelta = false",
      [req.params.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Pieza marcada como disponible' });
  } catch(err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// ── Resumen para dashboard ────────────────────────────────────────────────────
async function resumen(req, res, next) {
  try {
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE estado = 'recibida')    AS recibidas,
         COUNT(*) FILTER (WHERE estado = 'en_proceso')  AS en_proceso,
         COUNT(*) FILTER (WHERE estado = 'en_espera')   AS en_espera,
         COUNT(*) FILTER (WHERE estado = 'terminada')   AS terminadas,
         COUNT(*) FILTER (WHERE estado = 'entregada')   AS entregadas,
         COUNT(*) FILTER (WHERE fecha_prometida < CURRENT_DATE
           AND estado NOT IN ('entregada','cancelada'))  AS vencidas,
         COALESCE(SUM(total) FILTER (WHERE estado = 'entregada'
           AND updated_at >= date_trunc('month', NOW())), 0) AS facturado_mes
       FROM ordenes_trabajo WHERE empresa_id = $1`,
      [req.user.empresa_id]
    );
    res.json(result.rows[0]);
  } catch(err) { next(err); }
}

// ── Historial por número de serie ─────────────────────────────────────────────
async function historialSerie(req, res, next) {
  try {
    const { serie } = req.query;
    if (!serie?.trim()) return res.status(400).json({ error: 'Parámetro serie requerido' });

    const result = await db.query(
      `SELECT ot.id, ot.numero, ot.equipo, ot.num_serie, ot.descripcion,
              ot.estado, ot.prioridad, ot.total, ot.created_at, ot.updated_at,
              c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
              u.nombre AS tecnico_nombre
       FROM ordenes_trabajo ot
       JOIN clientes c ON c.id = ot.cliente_id
       LEFT JOIN usuarios u ON u.id = ot.tecnico_id
       WHERE ot.empresa_id = $1
         AND ot.num_serie ILIKE $2
       ORDER BY ot.created_at DESC`,
      [req.user.empresa_id, `%${serie.trim()}%`]
    );

    res.json(result.rows);
  } catch (err) { next(err); }
}

module.exports = { getAll, getById, create, cambiarEstado, solicitarPieza, marcarPiezaDisponible, resumen, historialSerie };
