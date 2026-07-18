const express = require('express');
const { authMiddleware, roles } = require('../middleware/auth');
const ctrl = require('../controllers/ordenes');
const router = express.Router();

router.use(authMiddleware);

router.get('/resumen',                  ctrl.resumen);
router.get('/historial-serie',          ctrl.historialSerie);
router.get('/',                         ctrl.getAll);
router.get('/:id',                      ctrl.getById);
router.post('/',                        ctrl.create);
router.patch('/:id/estado',             ctrl.cambiarEstado);
router.get('/:id/historial-estados',    ctrl.getHistorialEstados);
router.patch('/:id/cotizacion',         ctrl.guardarCotizacion);
router.post('/:id/solicitar-pieza',     ctrl.solicitarPieza);
router.post('/:id/pieza-disponible',    roles('admin','superadmin'), ctrl.marcarPiezaDisponible);

module.exports = router;
