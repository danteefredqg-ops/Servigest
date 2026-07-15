const express = require('express');
const { authMiddleware, soloAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/pedidos');
const router = express.Router();

router.use(authMiddleware);

router.get('/summary', ctrl.getSummary);
router.get('/export',  ctrl.exportExcel);
router.get('/',        ctrl.getAll);
router.get('/:id',     ctrl.getById);
router.post('/',       ctrl.create);              // operador puede crear
router.patch('/:id',   ctrl.update);              // operador puede editar
router.delete('/:id',  soloAdmin, ctrl.remove);   // solo admin elimina

module.exports = router;
