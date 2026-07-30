const express = require('express');
const { authMiddleware, soloAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/cxp');
const router = express.Router();

router.use(authMiddleware);
router.use(soloAdmin);

router.get('/resumen',         ctrl.getResumen);
router.get('/',                ctrl.getAll);
router.post('/',               ctrl.create);
router.post('/:id/pago',       ctrl.registrarPago);
router.get('/:id/historial',   ctrl.getHistorial);
router.delete('/:id',          ctrl.remove);

module.exports = router;
