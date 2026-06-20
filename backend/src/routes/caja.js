const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const ctrl = require('../controllers/caja');
const router = express.Router();

router.use(authMiddleware);

router.get('/corte', ctrl.corte);

module.exports = router;
