const express = require('express');
const { authMiddleware, soloAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/compras');
const router = express.Router();

router.use(authMiddleware);
router.use(soloAdmin);  // compras es solo admin — operador no ve esto

router.get('/export',       ctrl.exportExcel);
router.get('/',             ctrl.getAll);
router.post('/',            ctrl.create);
router.patch('/:id/estado', ctrl.updateEstado);
router.delete('/:id',       ctrl.remove);
router.post('/:id/pdf',     ctrl.adjuntarPDF);
router.get('/:id/pdf',      ctrl.getPDF);

module.exports = router;
