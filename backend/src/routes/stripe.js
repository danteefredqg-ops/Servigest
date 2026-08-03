const express = require('express');
const { authMiddleware, soloAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/stripe');
const router = express.Router();

// /webhook se monta directamente en app.js con express.raw() ANTES de express.json()

router.use(authMiddleware, soloAdmin);
router.get('/status',   ctrl.getPlanStatus);
router.post('/checkout', ctrl.createCheckoutSession);
router.post('/portal',   ctrl.getPortalSession);

module.exports = router;
