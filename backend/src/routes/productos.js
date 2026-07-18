const express = require('express');
const { authMiddleware, soloAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/productos');
const router = express.Router();

router.use(authMiddleware);

router.get('/stock-bajo',              ctrl.stockBajo);
router.get('/',                        ctrl.getAll);
router.get('/:id',                     ctrl.getById);
router.get('/:id/historial-precios',   ctrl.getHistorialPrecios);
router.post('/',                       soloAdmin, ctrl.create);
router.post('/:id/historial-precios',  soloAdmin, ctrl.addPrecioCompra);
router.patch('/:id',                   soloAdmin, ctrl.update);
router.delete('/:id',                  soloAdmin, ctrl.remove);

module.exports = router;
