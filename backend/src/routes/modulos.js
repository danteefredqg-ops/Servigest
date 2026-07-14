const express = require('express');
const router  = express.Router();
const { authMiddleware: auth, soloAdmin } = require('../middleware/auth');
const ctrl    = require('../controllers/modulos');

router.get('/',                    auth,            ctrl.getAll);
router.patch('/:modulo',  auth, soloAdmin, ctrl.toggle);

module.exports = router;
