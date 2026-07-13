const { log } = require('../middleware/audit');
const db = require('../db/connection');

// Facturapi se instancia POR empresa usando su key guardada en la BD
async function getFacturapiClient(empresa_id) {
  const result = await db.query(
    'SELECT facturapi_key FROM empresas WHERE id = $1',
    [empresa_id]
  );
  const key = result.rows[0]?.facturapi_key;
  if (!key) throw Object.assign(new Error('Esta empresa no tiene configurada su clave de Facturapi. Ve a Ajustes > Facturación.'), { status: 400 });

  const Facturapi = require('facturapi');
  return new Facturapi(key);
}

async function getAll(req, res, next) {
  try {
    const result = await db.query(
      `SELECT f.*, c.nombre AS cliente_nombre
       FROM facturas f JOIN clientes c ON c.id = f.cliente_id
       WHERE f.empresa_id = $1 ORDER BY f.created_at DESC`,
      [req.user.empresa_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const result = await db.query(
      `SELECT f.*, c.nombre AS cliente_nombre, c.rfc AS cliente_rfc,
              c.regimen_fiscal, c.uso_cfdi, c.email AS cliente_email
       FROM facturas f JOIN clientes c ON c.id = f.cliente_id
       WHERE f.id = $1 AND f.empresa_id = $2`,
      [req.params.id, req.user.empresa_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

// Crear factura en borrador (local, sin timbrar)
async function create(req, res, next) {
  try {
    const { cliente_id, pedido_id, items, notas } = req.body;
    if (!cliente_id || !items?.length) {
      return res.status(400).json({ error: 'cliente_id e items son requeridos' });
    }

    const clienteCheck = await db.query(
      'SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2',
      [cliente_id, req.user.empresa_id]
    );
    if (!clienteCheck.rows[0]) return res.status(400).json({ error: 'Cliente no válido' });

    const subtotal = items.reduce((s, i) => s + (i.cantidad * i.precio_unit), 0);
    const impuestos = subtotal * 0.16; // IVA 16%
    const total = subtotal + impuestos;

    const result = await db.query(
      `INSERT INTO facturas (empresa_id, pedido_id, cliente_id, items, subtotal, impuestos, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.empresa_id, pedido_id||null, cliente_id, JSON.stringify(items), subtotal, impuestos, total]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

// Timbrar CFDI con Facturapi
async function timbrar(req, res, next) {
  try {
    const factura = await db.query(
      `SELECT f.*, c.rfc AS cliente_rfc, c.nombre AS cliente_nombre,
              c.regimen_fiscal AS cliente_regimen, c.uso_cfdi,
              e.cp AS empresa_cp
       FROM facturas f
       JOIN clientes c ON c.id = f.cliente_id
       JOIN empresas  e ON e.id = f.empresa_id
       WHERE f.id = $1 AND f.empresa_id = $2`,
      [req.params.id, req.user.empresa_id]
    );

    if (!factura.rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
    const f = factura.rows[0];

    if (f.estado === 'timbrado') return res.status(400).json({ error: 'Esta factura ya fue timbrada' });
    if (!f.cliente_rfc)          return res.status(400).json({ error: 'El cliente no tiene RFC configurado' });

    const client = await getFacturapiClient(req.user.empresa_id);

    // Construir objeto para Facturapi
    const cfdiData = {
      customer: {
        legal_name:      f.cliente_nombre,
        tax_id:          f.cliente_rfc,
        tax_system:      f.cliente_regimen || '626',
        address: { zip: f.empresa_cp || '64000' },
      },
      use:   f.uso_cfdi || 'G03',
      items: f.items.map(item => ({
        quantity:     item.cantidad,
        product: {
          description:   item.descripcion,
          product_key:   item.clave_sat || '84111500',
          unit_key:      item.unidad_sat || 'E48',
          price:         item.precio_unit,
        },
      })),
      payment_form: '99',   // Por definir
    };

    const invoice = await client.invoices.create(cfdiData);

    // Guardar resultado en BD
    await db.query(
      `UPDATE facturas SET
         facturapi_id = $1, uuid_sat = $2, folio = $3,
         pdf_url = $4, xml_url = $5, estado = 'timbrado'
       WHERE id = $6`,
      [invoice.id, invoice.uuid, invoice.folio_number,
       invoice.pdf_url, invoice.xml_url, req.params.id]
    );

    await log(req, 'timbrar_factura', 'factura', req.params.id, { uuid: invoice.uuid, folio: invoice.folio_number });
    res.json({ message: 'Factura timbrada exitosamente', uuid: invoice.uuid });
  } catch (err) {
    // Facturapi lanza errores descriptivos — los pasamos directo
    if (err.status) return next(err);
    const msg = err.response?.data?.message || err.message;
    next(Object.assign(new Error(`Error SAT: ${msg}`), { status: 422 }));
  }
}

// Cancelar CFDI
async function cancelar(req, res, next) {
  try {
    const { motivo = '02' } = req.body; // 01=errores, 02=no requerida, 03=operación no realizada
    const factura = await db.query(
      'SELECT * FROM facturas WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.user.empresa_id]
    );

    if (!factura.rows[0])            return res.status(404).json({ error: 'Factura no encontrada' });
    if (factura.rows[0].estado !== 'timbrado') return res.status(400).json({ error: 'Solo se pueden cancelar facturas timbradas' });

    const client = await getFacturapiClient(req.user.empresa_id);
    await client.invoices.cancel(factura.rows[0].facturapi_id, { motive: motivo });

    await db.query(
      "UPDATE facturas SET estado = 'cancelado' WHERE id = $1",
      [req.params.id]
    );

    await log(req, 'cancelar_factura', 'factura', req.params.id, { motivo });
    res.json({ message: 'Factura cancelada' });
  } catch (err) {
    if (err.status) return next(err);          // errores propios (getFacturapiClient, etc.)
    if (!err.response) return next(err);       // errores de DB → 500 por defecto
    const msg = err.response?.data?.message || err.message;
    next(Object.assign(new Error(`Error cancelación SAT: ${msg}`), { status: 422 }));
  }
}

module.exports = { getAll, getById, create, timbrar, cancelar };
