const { log } = require('../middleware/audit');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db/connection');

// ── Registro (crea empresa + usuario admin) ──────────────────────────────────
async function register(req, res, next) {
  try {
    const { nombre, password, empresa } = req.body;
    const email = (req.body.email || '').toLowerCase().trim();

    if (!nombre || !email || !password || !empresa) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const existe = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      return res.status(409).json({ error: 'El correo ya está registrado' });
    }

    const trial_hasta = new Date();
    trial_hasta.setDate(trial_hasta.getDate() + 30);

    // Hash antes de abrir la transacción para no tenerla abierta más de lo necesario
    const hash = await bcrypt.hash(password, 12);

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const empRes = await client.query(
        `INSERT INTO empresas (nombre, plan, trial_hasta) VALUES ($1, 'trial', $2) RETURNING *`,
        [empresa, trial_hasta]
      );
      const emp = empRes.rows[0];

      const userRes = await client.query(
        `INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol)
         VALUES ($1, $2, $3, $4, 'admin') RETURNING id, nombre, email, rol, onboarding_ok`,
        [emp.id, nombre, email, hash]
      );

      await client.query('COMMIT');

      const user  = userRes.rows[0];
      const token = signToken(user, emp.id);

      res.status(201).json({
        token,
        user: { ...user, empresa_id: emp.id, empresa_nombre: emp.nombre },
        empresa: emp,
      });
    } catch (innerErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw innerErr;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const email    = (req.body.email || '').toLowerCase().trim();
    const password = req.body.password;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const result = await db.query(
      `SELECT u.*, e.nombre AS empresa_nombre, e.plan, e.trial_hasta, e.activa
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       WHERE LOWER(u.email) = $1`,
      [email]
    );

    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
    if (!user.activa) return res.status(403).json({ error: 'Cuenta suspendida, contacta soporte' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = signToken(user, user.empresa_id);
    const { password_hash, ...safeUser } = user;

    // Log login (req.user no existe aún, construir manualmente)
    req.user = { id: user.id, empresa_id: user.empresa_id, nombre: user.nombre };
    await log(req, 'login', 'usuario', user.id, { email: user.email });
    res.json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
}

// ── Perfil ────────────────────────────────────────────────────────────────────
async function me(req, res, next) {
  try {
    const result = await db.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.onboarding_ok,
              e.id AS empresa_id, e.nombre AS empresa_nombre,
              e.rfc, e.plan, e.trial_hasta, e.logo_url
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// ── Actualizar empresa (RFC, datos fiscales) ──────────────────────────────────
async function updateEmpresa(req, res, next) {
  try {
    const { nombre, rfc, regimen_fiscal, direccion_fiscal, cp, facturapi_key } = req.body;
    const result = await db.query(
      `UPDATE empresas
       SET nombre           = COALESCE($1, nombre),
           rfc              = COALESCE($2, rfc),
           regimen_fiscal   = COALESCE($3, regimen_fiscal),
           direccion_fiscal = COALESCE($4, direccion_fiscal),
           cp               = COALESCE($5, cp),
           facturapi_key    = COALESCE($7, facturapi_key)
       WHERE id = $6 RETURNING id, nombre, rfc, regimen_fiscal, plan`,
      [nombre, rfc, regimen_fiscal, direccion_fiscal, cp, req.user.empresa_id, facturapi_key || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

function signToken(user, empresa_id) {
  return jwt.sign(
    { id: user.id, empresa_id, rol: user.rol },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { register, login, me, updateEmpresa };
