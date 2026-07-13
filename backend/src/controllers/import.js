// import.js — Importación masiva desde Excel
const XLSX = require('xlsx');
const db   = require('../db/connection');

function parseExcel(buffer, sheetName) {
  const wb    = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[sheetName] || wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

// POST /api/import/clientes
async function importClientes(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const rows = parseExcel(req.file.buffer, 'Clientes');
    if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío' });

    const resultados = { importados: 0, omitidos: 0, errores: [] };

    for (const [i, row] of rows.entries()) {
      const nombre = String(row.nombre || row.Nombre || '').trim();
      if (!nombre) {
        resultados.errores.push({ fila: i + 2, error: 'Nombre vacío' });
        continue;
      }

      try {
        // Verificar duplicado por nombre (case-insensitive)
        const existe = await db.query(
          'SELECT id FROM clientes WHERE empresa_id = $1 AND LOWER(nombre) = LOWER($2)',
          [req.user.empresa_id, nombre]
        );
        if (existe.rows[0]) {
          resultados.omitidos++;
          continue;
        }

        await db.query(
          `INSERT INTO clientes (empresa_id, nombre, telefono, email, direccion, rfc)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            req.user.empresa_id,
            nombre,
            String(row.telefono || row.Telefono || '').trim() || null,
            String(row.email    || row.Email    || '').trim() || null,
            String(row.direccion|| row.Direccion|| '').trim() || null,
            String(row.rfc      || row.RFC      || '').trim() || null,
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

    const rows = parseExcel(req.file.buffer, 'Productos');
    if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío' });

    const resultados = { importados: 0, omitidos: 0, errores: [] };

    for (const [i, row] of rows.entries()) {
      const nombre = String(row.nombre || row.Nombre || '').trim();
      const sku    = String(row.sku    || row.SKU    || '').trim() || null;
      if (!nombre) {
        resultados.errores.push({ fila: i + 2, error: 'Nombre vacío' });
        continue;
      }

      try {
        // Verificar duplicado por SKU (si hay) o por nombre
        const existe = sku
          ? await db.query('SELECT id FROM productos WHERE empresa_id = $1 AND sku = $2', [req.user.empresa_id, sku])
          : await db.query('SELECT id FROM productos WHERE empresa_id = $1 AND LOWER(nombre) = LOWER($2)', [req.user.empresa_id, nombre]);

        if (existe.rows[0]) {
          resultados.omitidos++;
          continue;
        }

        await db.query(
          `INSERT INTO productos (empresa_id, nombre, descripcion, sku, unidad, precio, costo, stock, stock_minimo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            req.user.empresa_id,
            nombre,
            String(row.descripcion || '').trim() || null,
            sku,
            String(row.unidad      || 'servicio').trim(),
            parseFloat(row.precio  || 0),
            parseFloat(row.costo   || 0),
            parseInt(row.stock     || 0),
            parseInt(row.stock_minimo || 0),
          ]
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
      clientes:  [{ nombre: 'Juan López', telefono: '81 1234 5678', email: 'juan@ejemplo.com', rfc: 'LOPJ800101AAA', direccion: 'Monterrey, NL' }],
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

module.exports = { importClientes, importProductos, plantilla };
