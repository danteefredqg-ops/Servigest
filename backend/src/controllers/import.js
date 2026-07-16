// import.js — Importación masiva desde Excel / CSV con mapeador de columnas
const XLSX = require('xlsx');
const db   = require('../db/connection');

function parseFile(buffer) {
  const wb    = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

// Extrae un campo usando el mapping (si existe) o el nombre exacto/capitalizado
function getVal(row, field, map) {
  if (map && map[field]) return String(row[map[field]] ?? '').trim();
  const cap = field.charAt(0).toUpperCase() + field.slice(1);
  return String(row[field] || row[cap] || '').trim();
}

// POST /api/import/preview — devuelve columnas + muestra sin importar nada
async function preview(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const rows = parseFile(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío o no tiene datos' });
    const columns = Object.keys(rows[0]);
    res.json({ columns, sample: rows.slice(0, 5), total: rows.length });
  } catch (err) { next(err); }
}

// POST /api/import/clientes
async function importClientes(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const rows = parseFile(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío' });

    let map = null;
    if (req.body.mapping) {
      try { map = JSON.parse(req.body.mapping); }
      catch { return res.status(400).json({ error: 'El campo mapping no es JSON válido' }); }
    }
    const resultados = { importados: 0, omitidos: 0, errores: [] };

    for (const [i, row] of rows.entries()) {
      const nombre = getVal(row, 'nombre', map);
      if (!nombre) {
        resultados.errores.push({ fila: i + 2, error: 'Nombre vacío' });
        continue;
      }

      try {
        const rfcVal = (getVal(row, 'rfc', map) || '').toUpperCase() || null;
        const existe = await db.query(
          'SELECT id FROM clientes WHERE empresa_id = $1 AND LOWER(nombre) = LOWER($2)',
          [req.user.empresa_id, nombre]
        );
        if (existe.rows[0]) { resultados.omitidos++; continue; }

        await db.query(
          `INSERT INTO clientes
             (empresa_id, nombre, telefono, email, direccion, rfc,
              uso_cfdi, regimen_fiscal, cp, notas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            req.user.empresa_id,
            nombre,
            getVal(row, 'telefono',       map) || null,
            getVal(row, 'email',          map) || null,
            getVal(row, 'direccion',      map) || null,
            rfcVal,
            getVal(row, 'uso_cfdi',       map) || 'G03',
            getVal(row, 'regimen_fiscal', map) || null,
            getVal(row, 'cp',             map) || null,
            getVal(row, 'notas',          map) || null,
          ]
        );
        resultados.importados++;
      } catch (err) {
        resultados.errores.push({ fila: i + 2, error: err.message });
      }
    }

    res.json({
      message: `${resultados.importados} clientes importados, ${resultados.omitidos} omitidos (ya existían)`,
      ...resultados,
    });
  } catch (err) { next(err); }
}

// POST /api/import/productos
async function importProductos(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const rows = parseFile(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío' });

    let map = null;
    if (req.body.mapping) {
      try { map = JSON.parse(req.body.mapping); }
      catch { return res.status(400).json({ error: 'El campo mapping no es JSON válido' }); }
    }
    const resultados = { importados: 0, omitidos: 0, errores: [] };

    for (const [i, row] of rows.entries()) {
      const nombre = getVal(row, 'nombre', map);
      const sku    = getVal(row, 'sku', map) || null;
      if (!nombre) {
        resultados.errores.push({ fila: i + 2, error: 'Nombre vacío' });
        continue;
      }

      try {
        const existe = sku
          ? await db.query('SELECT id FROM productos WHERE empresa_id = $1 AND sku = $2', [req.user.empresa_id, sku])
          : await db.query('SELECT id FROM productos WHERE empresa_id = $1 AND LOWER(nombre) = LOWER($2)', [req.user.empresa_id, nombre]);

        if (existe.rows[0]) { resultados.omitidos++; continue; }

        const precio = parseFloat(getVal(row, 'precio', map)) || 0;
        const costo  = parseFloat(getVal(row, 'costo',  map)) || 0;
        const stock  = parseInt(getVal(row,   'stock',  map)) || 0;
        const sMin   = parseInt(getVal(row,   'stock_minimo', map)) || 0;
        const unidad = getVal(row, 'unidad', map) || 'servicio';
        const desc   = getVal(row, 'descripcion', map) || null;

        await db.query(
          `INSERT INTO productos (empresa_id, nombre, descripcion, sku, unidad, precio, costo, stock, stock_minimo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [req.user.empresa_id, nombre, desc, sku, unidad, precio, costo, stock, sMin]
        );
        resultados.importados++;
      } catch (err) {
        resultados.errores.push({ fila: i + 2, error: err.message });
      }
    }

    res.json({
      message: `${resultados.importados} productos importados, ${resultados.omitidos} omitidos (ya existían)`,
      ...resultados,
    });
  } catch (err) { next(err); }
}

// GET /api/import/plantilla/:tipo
async function plantilla(req, res, next) {
  try {
    const tipo = req.params.tipo;
    const plantillas = {
      clientes: [
        {
          nombre:         'Juan López García',
          rfc:            'LOGJ800101AAA',
          regimen_fiscal: '612',
          uso_cfdi:       'G03',
          cp:             '64000',
          telefono:       '81 1234 5678',
          email:          'juan@ejemplo.com',
          direccion:      'Av. Garza Sada 123, Col. Tecnológico, Monterrey, NL',
          notas:          'Cliente frecuente',
        },
        {
          nombre:         'Transportes del Norte SA de CV',
          rfc:            'TNO980201B3A',
          regimen_fiscal: '601',
          uso_cfdi:       'G01',
          cp:             '66400',
          telefono:       '81 8765 4321',
          email:          'contabilidad@transpnorte.com',
          direccion:      'Blvd. Industrial 500, San Nicolás, NL',
          notas:          '',
        },
      ],
      productos: [{ nombre: 'Servicio de plomería', descripcion: 'Revisión y reparación', sku: 'PLO-001', unidad: 'servicio', precio: 1500, costo: 500, stock: 0, stock_minimo: 0 }],
    };

    if (!plantillas[tipo]) return res.status(400).json({ error: 'Tipo inválido. Usa: clientes o productos' });

    const wb   = XLSX.utils.book_new();
    const ws   = XLSX.utils.json_to_sheet(plantillas[tipo]);
    XLSX.utils.book_append_sheet(wb, ws, tipo.charAt(0).toUpperCase() + tipo.slice(1));

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="plantilla_${tipo}.xlsx"`);
    res.send(buffer);
  } catch (err) { next(err); }
}

module.exports = { preview, importClientes, importProductos, plantilla };
