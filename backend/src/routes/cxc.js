const express = require('express');
const { authMiddleware, adminOContador } = require('../middleware/auth');
const ctrl = require('../controllers/cxc');
const router = express.Router();

router.use(authMiddleware);
router.use(adminOContador);  // operador no ve CxC

router.get('/resumen',              ctrl.resumen);
router.get('/export',               ctrl.exportExcel);
router.post('/recordatorios',       ctrl.generarRecordatorios);
router.get('/',                     ctrl.getAll);
router.post('/',         ctrl.create);
router.post('/:id/pago', ctrl.registrarPago);

module.exports = router;
