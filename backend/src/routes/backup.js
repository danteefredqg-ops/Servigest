const express = require('express');
const { authMiddleware, soloAdmin } = require('../middleware/auth');
const db = require('../db/connection');
const router = express.Router();

router.use(authMiddleware);
router.use(soloAdmin);

// GET /api/backup — descarga JSON completo de todos los datos de la empresa
router.get('/', async (req, res, next) => {
  try {
    const eid = req.user.empresa_id;

    const [clientes, productos, pedidos, ordenes, cxc, cotizaciones, compras, garantias] =
      await Promise.all([
        db.query('SELECT * FROM clientes             WHERE empresa_id = $1 ORDER BY id', [eid]),
        db.query('SELECT * FROM productos            WHERE empresa_id = $1 ORDER BY id', [eid]),
        db.query('SELECT * FROM pedidos              WHERE empresa_id = $1 ORDER BY id', [eid]),
        db.query('SELECT * FROM ordenes_trabajo      WHERE empresa_id = $1 ORDER BY id', [eid]),
        db.query('SELECT * FROM cuentas_por_cobrar   WHERE empresa_id = $1 ORDER BY id', [eid]),
        db.query('SELECT * FROM cotizaciones         WHERE empresa_id = $1 ORDER BY id', [eid]),
        db.query('SELECT * FROM compras              WHERE empresa_id = $1 ORDER BY id', [eid]),
        db.query('SELECT * FROM garantias            WHERE empresa_id = $1 ORDER BY id', [eid]),
      ]);

    const payload = {
      exportado_en: new Date().toISOString(),
      empresa_id: eid,
      clientes:      clientes.rows,
      productos:     productos.rows,
      pedidos:       pedidos.rows,
      ordenes:       ordenes.rows,
      cxc:           cxc.rows,
      cotizaciones:  cotizaciones.rows,
      compras:       compras.rows,
      garantias:     garantias.rows,
    };

    res.set({
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="backup_servigest_${new Date().toISOString().slice(0,10)}.json"`,
    });
    res.json(payload);
  } catch(err) { next(err); }
});

module.exports = router;
