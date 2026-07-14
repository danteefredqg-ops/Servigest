const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const ctrl    = require('../controllers/modulos');

router.get('/',           auth, ctrl.getAll);
router.patch('/:modulo',  auth, ctrl.toggle);

module.exports = router;
