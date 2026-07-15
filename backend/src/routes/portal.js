const express = require('express');
const db = require('../db/connection');
const router = express.Router();

// GET /api/portal/ot/:numero — consulta pública de OT (sin autenticación)
router.get('/ot/:numero', async (req, res, next) => {
  try {
    const numero = parseInt(req.params.numero);
    if (!numero || numero < 1) {
      return res.status(400).json({ error: 'Número de OT inválido' });
    }

    const result = await db.query(
      `SELECT ot.numero AS numero_ot, ot.equipo, ot.tipo_equipo, ot.modelo, ot.num_serie,
              ot.descripcion, ot.estado, ot.fecha_prometida, ot.created_at,
              c.nombre AS cliente_nombre,
              e.nombre AS empresa_nombre,
              e.direccion_fiscal AS empresa_dir
       FROM ordenes_trabajo ot
       JOIN clientes c ON c.id = ot.cliente_id
       JOIN empresas e ON e.id = ot.empresa_id
       WHERE ot.numero = $1`,
      [numero]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Orden de trabajo no encontrada' });
    }

    const ot = result.rows[0];
    res.json({
      numero_ot:       ot.numero_ot,
      equipo:          [ot.tipo_equipo, ot.modelo, ot.equipo].filter(Boolean).join(' · '),
      num_serie:       ot.num_serie,
      descripcion:     ot.descripcion,
      estado:          ot.estado,
      fecha_entrega:   ot.fecha_prometida,
      creado:          ot.created_at,
      cliente_nombre:  ot.cliente_nombre,
      empresa_nombre:  ot.empresa_nombre,
      empresa_dir:     ot.empresa_dir,
    });
  } catch(err) { next(err); }
});

module.exports = router;
