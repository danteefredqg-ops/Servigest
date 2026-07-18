const db = require('../db/connection');

const MODULOS_DISPONIBLES = [
  { id:'clientes',     nombre:'Clientes',            descripcion:'Directorio y gestión de clientes' },
  { id:'ordenes',      nombre:'Órdenes de Trabajo',  descripcion:'Reparaciones, servicios y seguimiento de equipos' },
  { id:'inventario',   nombre:'Inventario',           descripcion:'Productos, stock y control de precios' },
  { id:'cotizaciones', nombre:'Cotizaciones',         descripcion:'Presupuestos y propuestas para clientes' },
  { id:'pos',          nombre:'Punto de Venta',       descripcion:'Cobro rápido con POS táctil' },
  { id:'pedidos',      nombre:'Pedidos',              descripcion:'Control de pedidos y entregas' },
  { id:'compras',      nombre:'Compras',              descripcion:'Proveedores y entradas de inventario' },
  { id:'facturas',     nombre:'Facturas CFDI',        descripcion:'Timbrado SAT y facturación electrónica' },
  { id:'cxc',          nombre:'Cuentas por Cobrar',   descripcion:'Control de adeudos y pagos pendientes' },
  { id:'caja',         nombre:'Corte de Caja',        descripcion:'Resumen diario de ventas y cobros' },
  { id:'garantias',    nombre:'Garantías',            descripcion:'Control de garantías por equipo y cliente' },
  { id:'reportes',     nombre:'Reportes / Finanzas',  descripcion:'Dashboard financiero y análisis de ingresos' },
  { id:'alertas',      nombre:'Alertas',              descripcion:'Notificaciones de stock bajo y OTs' },
];

async function getAll(req, res, next) {
  try {
    const result = await db.query(
      'SELECT modulo, activo FROM modulos_config WHERE empresa_id = $1',
      [req.user.empresa_id]
    );

    // Mapear los activos de la DB
    const activosMap = {};
    result.rows.forEach(r => { activosMap[r.modulo] = r.activo; });

    // Devolver lista completa con estado (default = true si no existe en DB)
    const lista = MODULOS_DISPONIBLES.map(m => ({
      ...m,
      activo: activosMap[m.id] !== undefined ? activosMap[m.id] : true,
    }));

    res.json(lista);
  } catch (err) { next(err); }
}

async function toggle(req, res, next) {
  try {
    const { modulo } = req.params;
    const { activo }  = req.body;

    if (!MODULOS_DISPONIBLES.find(m => m.id === modulo)) {
      return res.status(400).json({ error: 'Módulo no válido' });
    }
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ error: '"activo" debe ser true o false' });
    }

    await db.query(
      `INSERT INTO modulos_config (empresa_id, modulo, activo)
       VALUES ($1, $2, $3)
       ON CONFLICT (empresa_id, modulo) DO UPDATE SET activo = EXCLUDED.activo`,
      [req.user.empresa_id, modulo, activo]
    );

    res.json({ modulo, activo });
  } catch (err) { next(err); }
}

module.exports = { getAll, toggle };
