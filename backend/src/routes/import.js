const express  = require('express');
const multer   = require('multer');
const { authMiddleware: auth } = require('../middleware/auth');
const ctrl     = require('../controllers/import');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_UPLOAD_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const ok = file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel')
               || file.mimetype.includes('csv') || file.mimetype.includes('text/plain')
               || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv');
    cb(ok ? null : new Error('Solo se permiten archivos Excel (.xlsx, .xls) o CSV (.csv)'), ok);
  },
});

const router = express.Router();
router.use(auth);
router.get('/plantilla/:tipo',           ctrl.plantilla);
router.post('/preview',   upload.single('archivo'), ctrl.preview);
router.post('/clientes',  upload.single('archivo'), ctrl.importClientes);
router.post('/productos', upload.single('archivo'), ctrl.importProductos);
module.exports = router;
