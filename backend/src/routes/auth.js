const express = require('express');
const { register, login, me, updateEmpresa, forgotPassword, resetPassword } = require('../controllers/auth');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/register',         register);
router.post('/login',            login);
router.post('/forgot-password',  forgotPassword);
router.post('/reset-password',   resetPassword);
router.get('/me',                authMiddleware, me);
router.patch('/empresa',         authMiddleware, updateEmpresa);

module.exports = router;
