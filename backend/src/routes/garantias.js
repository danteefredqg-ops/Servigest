const express = require('express');
const { authMiddleware, soloAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/garantias');
const router = express.Router();

router.use(authMiddleware);

router.get('/',             ctrl.getAll);
router.post('/',            ctrl.create);
router.patch('/:id/estado', ctrl.updateEstado);
router.delete('/:id',       soloAdmin, ctrl.remove);

module.exports = router;
