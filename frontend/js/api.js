// api.js — cliente HTTP centralizado ServiGest v2

// API_URL se toma de config.js si existe, si no usa Railway por defecto
const API_URL = (typeof CONFIG !== 'undefined' ? CONFIG.API_URL : null)
  || 'https://quintero-facturacion.up.railway.app/api';

const api = {

  // ── Token / sesión ────────────────────────────────────────────────────────
  getToken()  { return localStorage.getItem('sg_token'); },
  setToken(t) { localStorage.setItem('sg_token', t); },
  getUser()   { try { return JSON.parse(localStorage.getItem('sg_user')); } catch { return null; } },
  setUser(u)  { localStorage.setItem('sg_user', JSON.stringify(u)); },
  isAuthenticated() { return !!this.getToken(); },

  logout() {
    localStorage.removeItem('sg_token');
    localStorage.removeItem('sg_user');
    const path = window.location.pathname;
    const root = path.indexOf('/pages/') >= 0 ? path.substring(0, path.indexOf('/pages/')) : '';
    window.location.href = root + '/pages/auth/login.html';
  },

  // ── Request base ──────────────────────────────────────────────────────────
  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    };

    let res;
    try {
      res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
    } catch(e) {
      throw new Error('No se pudo conectar al servidor. Verifica tu internet.');
    }

    if (res.status === 401 && !endpoint.includes('/auth/')) {
      this.logout();
      return;
    }

    // Respuestas binarias
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('spreadsheet') || ct.includes('pdf') || ct.includes('xml') || ct.includes('csv')) {
      if (!res.ok) throw new Error('Error descargando archivo');
      return res.blob();
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Respuesta inesperada del servidor');
    }

    if (!res.ok) {
      // Mensajes de error amigables
      const mensajes = {
        'El correo ya está registrado':     'Ese correo ya tiene una cuenta. ¿Quieres iniciar sesión?',
        'Credenciales incorrectas':         'Correo o contraseña incorrectos. Intenta de nuevo.',
        'Token requerido':                  'Tu sesión expiró. Inicia sesión de nuevo.',
        'Token inválido o expirado':        'Tu sesión expiró. Inicia sesión de nuevo.',
        'Acceso denegado':                  'No tienes permiso para hacer eso.',
        'cliente_id es requerido':          'Selecciona un cliente para continuar.',
        'Agrega al menos un producto':      'Agrega al menos un producto o servicio al pedido.',
      };
      const msg = data.error || 'Error desconocido';
      throw new Error(mensajes[msg] || msg);
    }

    return data;
  },

  get(ep)         { return this.request(ep,  { method:'GET' }); },
  post(ep, body)  { return this.request(ep,  { method:'POST',   body: JSON.stringify(body) }); },
  patch(ep, body) { return this.request(ep,  { method:'PATCH',  body: JSON.stringify(body) }); },
  delete(ep)      { return this.request(ep,  { method:'DELETE' }); },

  // Upload multipart
  upload(ep, formData) {
    const token = this.getToken();
    return fetch(`${API_URL}${ep}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error subiendo archivo');
      return d;
    });
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  async login(email, password) {
    const d = await this.post('/auth/login', { email, password });
    this.setToken(d.token);
    this.setUser(d.user);
    return d;
  },
  async register(nombre, email, password, empresa) {
    const d = await this.post('/auth/register', { nombre, email, password, empresa });
    this.setToken(d.token);
    this.setUser(d.user);
    return d;
  },

  // ── Pedidos ───────────────────────────────────────────────────────────────
  pedidos: {
    list:   (f={}) => api.get('/pedidos'  + buildQuery(f)),
    get:    (id)   => api.get(`/pedidos/${id}`),
    create: (b)    => api.post('/pedidos', b),
    update: (id,b) => api.patch(`/pedidos/${id}`, b),
    delete: (id)   => api.delete(`/pedidos/${id}`),
  },

  // ── Clientes ──────────────────────────────────────────────────────────────
  clientes: {
    list:   (f={}) => api.get('/clientes' + buildQuery(f)),
    get:    (id)   => api.get(`/clientes/${id}`),
    create: (b)    => api.post('/clientes', b),
    update: (id,b) => api.patch(`/clientes/${id}`, b),
    delete: (id)   => api.delete(`/clientes/${id}`),
  },

  // ── Productos ─────────────────────────────────────────────────────────────
  productos: {
    list:             (f={})    => api.get('/productos' + buildQuery(f)),
    stockBajo:        ()        => api.get('/productos/stock-bajo'),
    get:              (id)      => api.get(`/productos/${id}`),
    create:           (b)       => api.post('/productos', b),
    update:           (id,b)    => api.patch(`/productos/${id}`, b),
    delete:           (id)      => api.delete(`/productos/${id}`),
    historialPrecios: (id)      => api.get(`/productos/${id}/historial-precios`),
    addPrecioCompra:  (id,b)    => api.post(`/productos/${id}/historial-precios`, b),
  },

  // ── Cotizaciones ──────────────────────────────────────────────────────────
  cotizaciones: {
    list:         (f={})      => api.get('/cotizaciones' + buildQuery(f)),
    get:          (id)        => api.get(`/cotizaciones/${id}`),
    create:       (b)         => api.post('/cotizaciones', b),
    updateEstado: (id,estado) => api.patch(`/cotizaciones/${id}/estado`, { estado }),
    delete:       (id)        => api.delete(`/cotizaciones/${id}`),
  },

  // ── Facturas ──────────────────────────────────────────────────────────────
  facturas: {
    list:     (f={})  => api.get('/facturas' + buildQuery(f)),
    get:      (id)    => api.get(`/facturas/${id}`),
    create:   (b)     => api.post('/facturas', b),
    timbrar:  (id)    => api.post(`/facturas/${id}/timbrar`, {}),
    cancelar: (id,m)  => api.post(`/facturas/${id}/cancelar`, { motivo: m }),
  },

  // ── CxC ───────────────────────────────────────────────────────────────────
  cxc: {
    resumen:       ()       => api.get('/cxc/resumen'),
    list:          (f={})   => api.get('/cxc' + buildQuery(f)),
    create:        (b)      => api.post('/cxc', b),
    pago:          (id,b)   => api.post(`/cxc/${id}/pago`, b),
    recordatorios: ()       => api.post('/cxc/recordatorios', {}),
  },

  // ── Compras ───────────────────────────────────────────────────────────────
  compras: {
    list:         (f={})      => api.get('/compras' + buildQuery(f)),
    create:       (b)         => api.post('/compras', b),
    updateEstado: (id,estado) => api.patch(`/compras/${id}/estado`, { estado }),
  },

  // ── Órdenes de trabajo ────────────────────────────────────────────────────
  ordenes: {
    resumen:              ()        => api.get('/ordenes/resumen'),
    list:                 (f={})    => api.get('/ordenes' + buildQuery(f)),
    get:                  (id)      => api.get(`/ordenes/${id}`),
    create:               (b)       => api.post('/ordenes', b),
    cambiarEstado:        (id,b)    => api.patch(`/ordenes/${id}/estado`, b),
    guardarCotizacion:    (id,b)    => api.patch(`/ordenes/${id}/cotizacion`, b),
    solicitarPieza:       (id,b)    => api.post(`/ordenes/${id}/solicitar-pieza`, b),
    marcarPiezaDisponible:(id,b)    => api.post(`/ordenes/${id}/pieza-disponible`, b),
    historialSerie:       (serie)   => api.get('/ordenes/historial-serie' + buildQuery({ serie })),
  },

  // ── Alertas ───────────────────────────────────────────────────────────────
  alertas: {
    list:       (f={})  => api.get('/alertas' + buildQuery(f)),
    conteo:     ()      => api.get('/alertas/conteo'),
    leerTodas:  ()      => api.patch('/alertas/leer-todas', {}),
    leer:       (id)    => api.patch(`/alertas/${id}/leer`, {}),
    resolver:   (id)    => api.patch(`/alertas/${id}/resolver`, {}),
  },

  // ── Reportes ──────────────────────────────────────────────────────────────
  reportes: {
    dashboard:   ()     => api.get('/reportes/dashboard'),
    ingresos:    (f={}) => api.get('/reportes/ingresos' + buildQuery(f)),
    clientesTop: ()     => api.get('/reportes/clientes-top'),
    cxcVencidas: ()     => api.get('/reportes/cxc-vencidas'),
    ingresosXlsx: async (f={}) => {
      const blob = await api.get('/reportes/ingresos' + buildQuery({...f, formato:'xlsx'}));
      descargarBlob(blob, 'reporte_ingresos.xlsx');
    },
  },

  // ── Importación ───────────────────────────────────────────────────────────
  import: {
    clientes:  (file) => { const fd=new FormData(); fd.append('archivo',file); return api.upload('/import/clientes', fd); },
    productos: (file) => { const fd=new FormData(); fd.append('archivo',file); return api.upload('/import/productos', fd); },
    // Con mapeador de columnas personalizado
    clientesMapeados:  (file, mapping) => { const fd=new FormData(); fd.append('archivo',file); fd.append('mapping',JSON.stringify(mapping)); return api.upload('/import/clientes',  fd); },
    productosMapeados: (file, mapping) => { const fd=new FormData(); fd.append('archivo',file); fd.append('mapping',JSON.stringify(mapping)); return api.upload('/import/productos', fd); },
    preview: (file) => { const fd=new FormData(); fd.append('archivo',file); return api.upload('/import/preview', fd); },
    plantilla: async (tipo) => {
      const blob = await api.get(`/import/plantilla/${tipo}`);
      descargarBlob(blob, `plantilla_${tipo}.xlsx`);
    },
  },

  // ── Servicios ─────────────────────────────────────────────────────────────
  servicios: {
    list:   ()      => api.get('/servicios'),
    create: (b)     => api.post('/servicios', b),
    update: (id,b)  => api.patch(`/servicios/${id}`, b),
    delete: (id)    => api.delete(`/servicios/${id}`),
  },

  // ── Usuarios ──────────────────────────────────────────────────────────────
  usuarios: {
    list:          ()         => api.get('/usuarios'),
    create:        (b)        => api.post('/usuarios', b),
    update:        (id, b)    => api.patch(`/usuarios/${id}`, b),
    resetPassword: (id, pass) => api.patch(`/usuarios/${id}/password`, { password: pass }),
    delete:        (id)       => api.delete(`/usuarios/${id}`),
  },

  // ── Auditoría ─────────────────────────────────────────────────────────────
  audit: {
    list:       (f={}) => api.get('/audit' + buildQuery(f)),
    resumen:    ()     => api.get('/audit/resumen'),
    porUsuario: ()     => api.get('/audit/usuarios'),
  },

  // ── Caja ──────────────────────────────────────────────────────────────────
  caja: {
    corte: (fecha) => api.get('/caja/corte' + (fecha ? `?fecha=${fecha}` : '')),
  },

  // ── Garantías ─────────────────────────────────────────────────────────────
  garantias: {
    list:         ()         => api.get('/garantias'),
    create:       (b)        => api.post('/garantias', b),
    updateEstado: (id,estado) => api.patch(`/garantias/${id}/estado`, { estado }),
    delete:       (id)       => api.delete(`/garantias/${id}`),
  },

  // ── Módulos ───────────────────────────────────────────────────────────────
  modulos: {
    list:   ()          => api.get('/modulos'),
    toggle: (id, activo) => api.patch(`/modulos/${id}`, { activo }),
  },

  // ── Backup ────────────────────────────────────────────────────────────────
  backup: () => api.get('/backup'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildQuery(f={}) {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k,v]) => { if(v !== undefined && v !== null && v !== '') p.append(k,v); });
  const s = p.toString();
  return s ? `?${s}` : '';
}

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
