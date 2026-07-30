const db = require('../db/connection');

async function getAll(req, res, next) {
  try {
    const { estado } = req.query;
    let q = `
      SELECT cxc.*, c.nombre AS cliente_nombre, c.telefono AS cliente_tel
      FROM cuentas_por_cobrar cxc
      JOIN clientes c ON c.id = cxc.cliente_id
      WHERE cxc.empresa_id = $1
    `;
    const params = [req.user.empresa_id];
    if (estado) { q += ' AND cxc.estado = $2'; params.push(estado); }
    q += ' ORDER BY cxc.fecha_vence ASC';

    const result = await db.query(q, params);
    res.json(result.rows);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { cliente_id, pedido_id, factura_id, monto, fecha_vence, notas } = req.body;
    if (!cliente_id || !monto || !fecha_vence) {
      return res.status(400).json({ error: 'cliente_id, monto y fecha_vence son requeridos' });
    }

    const clienteCheck = await db.query(
      'SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2',
      [cliente_id, req.user.empresa_id]
    );
    if (!clienteCheck.rows[0]) return res.status(400).json({ error: 'Cliente no válido' });

    const result = await db.query(
      `INSERT INTO cuentas_por_cobrar (empresa_id, cliente_id, pedido_id, factura_id, monto, fecha_vence, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.empresa_id, cliente_id, pedido_id||null, factura_id||null, monto, fecha_vence, notas]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

const FORMA_PAGO_SAT = {
  efectivo:      '01',
  cheque:        '02',
  transferencia: '03',
  tarjeta:       '28',
  por_definir:   '99',
};

// Registrar pago parcial o total
async function registrarPago(req, res, next) {
  const client = await db.connect();
  try {
    const { monto, metodo, referencia, fecha, notas, emitir_complemento } = req.body;
    if (!monto || Number(monto) <= 0) {
      return res.status(400).json({ error: 'monto es requerido y debe ser mayor a cero' });
    }

    await client.query('BEGIN');

    // FOR UPDATE bloquea la fila para evitar race conditions en pagos concurrentes
    const cxcRes = await client.query(
      `SELECT cxc.*, f.facturapi_id, f.uuid_sat,
              c.nombre AS cli_nombre, c.rfc AS cli_rfc,
              c.regimen_fiscal AS cli_regimen, c.cp AS cli_cp,
              e.cp AS emp_cp
       FROM cuentas_por_cobrar cxc
       LEFT JOIN facturas f   ON f.id = cxc.factura_id AND f.estado = 'timbrado'
       LEFT JOIN clientes c   ON c.id = cxc.cliente_id
       LEFT JOIN empresas e   ON e.id = cxc.empresa_id
       WHERE cxc.id = $1 AND cxc.empresa_id = $2 FOR UPDATE OF cxc`,
      [req.params.id, req.user.empresa_id]
    );
    const cxc = cxcRes.rows[0];
    if (!cxc) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'CxC no encontrada' }); }

    // Emitir complemento de pago SAT si se solicitó y hay factura timbrada
    let complementoUuid  = null;
    let complementoFpId  = null;
    let complementoError = null;
    if (emitir_complemento && cxc.uuid_sat) {
      try {
        const { getFacturapiClient } = require('./facturas');
        const fpClient = await getFacturapiClient(req.user.empresa_id);
        const saldoPrevio = Number(cxc.monto) - Number(cxc.monto_pagado);
        const comp = await fpClient.invoices.create({
          type: 'P',
          customer: {
            legal_name: cxc.cli_nombre,
            tax_id:     cxc.cli_rfc,
            tax_system: cxc.cli_regimen || '626',
            address:    { zip: cxc.cli_cp || cxc.emp_cp },
          },
          payments: [{
            form:     FORMA_PAGO_SAT[metodo] || '99',
            date:     fecha ? new Date(fecha) : new Date(),
            currency: 'MXN',
            related_documents: [{
              uuid:         cxc.uuid_sat,
              amount:       Number(monto),
              installment:  1,
              last_balance: saldoPrevio,
            }],
          }],
        });
        complementoUuid = comp.uuid;
        complementoFpId = comp.id;
      } catch (compErr) {
        console.error('[CXC] Error emitiendo complemento:', compErr.message);
        complementoError = compErr.response?.data?.message || compErr.message;
      }
    }

    await client.query(
      `INSERT INTO pagos_cxc (cxc_id, monto, metodo, referencia, fecha, notas, complemento_uuid, complemento_facturapi_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cxc.id, monto, metodo || 'efectivo', referencia, fecha || new Date(), notas,
       complementoUuid, complementoFpId]
    );

    const nuevoPagado = Number(cxc.monto_pagado) + Number(monto);
    const nuevoEstado = nuevoPagado >= Number(cxc.monto) ? 'pagada' : 'parcial';

    await client.query(
      'UPDATE cuentas_por_cobrar SET monto_pagado = $1, estado = $2 WHERE id = $3',
      [nuevoPagado, nuevoEstado, cxc.id]
    );

    await client.query('COMMIT');
    res.json({
      message:           'Pago registrado',
      estado:            nuevoEstado,
      monto_pagado:      nuevoPagado,
      complemento_uuid:  complementoUuid   || undefined,
      complemento_error: complementoError  || undefined,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

// Resumen de CxC para dashboard
async function resumen(req, res, next) {
  try {
    const result = await db.query(
      `SELECT
         COALESCE(SUM(monto - monto_pagado) FILTER (WHERE estado IN ('pendiente','parcial')), 0) AS por_cobrar,
         COALESCE(SUM(monto - monto_pagado) FILTER (WHERE estado = 'vencida'), 0) AS vencido,
         COUNT(*) FILTER (WHERE estado = 'vencida') AS cuentas_vencidas,
         COUNT(*) FILTER (WHERE estado IN ('pendiente','parcial')) AS cuentas_vigentes,
         COALESCE(SUM(monto_pagado) FILTER (
           WHERE estado = 'pagada'
             AND updated_at >= date_trunc('month', NOW())
         ), 0) AS cobrado_mes
       FROM cuentas_por_cobrar WHERE empresa_id = $1`,
      [req.user.empresa_id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

// Revisa CxC pendientes y crea alertas para vencidas y las que vencen en ≤3 días.
// Es idempotente: no duplica alertas si ya se generó hoy.
async function generarRecordatorios(req, res, next) {
  try {
    const eid = req.user.empresa_id;

    // Traer CxC pendientes o parciales que vencen pronto o ya vencieron
    const { rows: pendientes } = await db.query(
      `SELECT cxc.id, cxc.monto, cxc.monto_pagado, cxc.fecha_vence, c.nombre AS cliente
       FROM cuentas_por_cobrar cxc
       JOIN clientes c ON c.id = cxc.cliente_id
       WHERE cxc.empresa_id = $1
         AND cxc.estado IN ('pendiente','parcial')
         AND cxc.fecha_vence <= (CURRENT_DATE + INTERVAL '3 days')`,
      [eid]
    );

    if (!pendientes.length) return res.json({ creadas: 0 });

    // Alertas de CxC ya creadas HOY para esta empresa (evitar duplicados)
    const { rows: existentes } = await db.query(
      `SELECT titulo FROM alertas
       WHERE empresa_id = $1 AND created_at >= CURRENT_DATE AND tipo = 'info'
         AND titulo LIKE 'CxC%'`,
      [eid]
    );
    const titExist = new Set(existentes.map(a => a.titulo));

    let creadas = 0;
    for (const cxc of pendientes) {
      const hoy  = new Date();
      const vence = new Date(cxc.fecha_vence);
      const dias  = Math.ceil((vence - hoy) / 86400000);
      const saldo = Number(cxc.monto) - Number(cxc.monto_pagado);
      const montoStr = new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:0}).format(saldo);

      const titulo = dias < 0
        ? `CxC vencida — ${cxc.cliente}`
        : `CxC próxima — ${cxc.cliente}`;

      if (titExist.has(titulo)) continue;

      const mensaje = dias < 0
        ? `Cuenta de ${montoStr} lleva ${Math.abs(dias)} día(s) vencida.`
        : `Cuenta de ${montoStr} vence en ${dias} día(s).`;

      await db.query(
        `INSERT INTO alertas (empresa_id, tipo, titulo, mensaje, para_rol)
         VALUES ($1, 'info', $2, $3, 'admin')`,
        [eid, titulo, mensaje]
      );
      titExist.add(titulo);
      creadas++;
    }

    res.json({ creadas });
  } catch(err) { next(err); }
}

async function exportExcel(req, res, next) {
  try {
    const XLSX = require('xlsx');
    const result = await db.query(
      `SELECT c.nombre AS cliente, cxc.monto, cxc.monto_pagado,
              (cxc.monto - cxc.monto_pagado) AS saldo,
              cxc.estado, cxc.fecha_vence, cxc.notas
       FROM cuentas_por_cobrar cxc
       JOIN clientes c ON c.id = cxc.cliente_id
       WHERE cxc.empresa_id = $1
       ORDER BY cxc.fecha_vence ASC`,
      [req.user.empresa_id]
    );
    const rows = result.rows.map(r => ({
      'Cliente':       r.cliente,
      'Monto':         Number(r.monto),
      'Pagado':        Number(r.monto_pagado),
      'Saldo':         Number(r.saldo),
      'Estado':        r.estado,
      'Vence':         r.fecha_vence ? new Date(r.fecha_vence).toLocaleDateString('es-MX') : '',
      'Notas':         r.notas || '',
    }));
    const ws  = XLSX.utils.json_to_sheet(rows);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CxC');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'Content-Disposition': 'attachment; filename="cuentas_por_cobrar.xlsx"' });
    res.send(buf);
  } catch(err) { next(err); }
}

module.exports = { getAll, create, registrarPago, resumen, generarRecordatorios, exportExcel };
