const express = require('express');
const { authMiddleware, adminOContador } = require('../middleware/auth');
const ctrl = require('../controllers/reportes');
const router = express.Router();

router.use(authMiddleware);
router.use(adminOContador);  // operador NO puede ver reportes financieros

router.get('/dashboard',    ctrl.dashboardCompleto);
router.get('/ingresos',     ctrl.ingresos);
router.get('/clientes-top', ctrl.clientesTop);
router.get('/cxc-vencidas', ctrl.cxcVencidas);
router.get('/contpaq',      ctrl.exportContpaq);

module.exports = router;
