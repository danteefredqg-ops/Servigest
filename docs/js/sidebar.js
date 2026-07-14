// sidebar.js — navegación centralizada ServiGest

const NAV_ITEMS = [
  { id:'dashboard',    label:'Inicio',            href:'../dashboard/dashboard.html',
    icon:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
  { id:'caja',         label:'Corte de Caja',      href:'../caja/caja.html',
    icon:'<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>' },
  { id:'pos',          label:'Punto de Venta',    href:'../pos/pos.html',
    icon:'<path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>',
    badge: '⚡' },
  { id:'garantias',    label:'Garantías',           href:'../garantias/garantias.html',
    icon:'<path d="M9 12l2 2 4-4"/><path d="M21 12c0 5-4.5 9-9 9S3 17 3 12V5l9-3 9 3v7z"/>' },
  { id:'ordenes',      label:'Órdenes de Trabajo', href:'../ordenes/ordenes.html',
    icon:'<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>' },
  { id:'pedidos',      label:'Pedidos',            href:'../pedidos/pedidos.html',
    icon:'<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>' },
  { id:'clientes',     label:'Clientes',           href:'../clientes/clientes.html',
    icon:'<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>' },
  { id:'productos',    label:'Inventario',         href:'../productos/productos.html',
    icon:'<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>' },
  { id:'facturas',     label:'Facturas CFDI',      href:'../facturas/facturas.html',
    icon:'<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
  { id:'cotizaciones', label:'Cotizaciones',       href:'../cotizaciones/cotizaciones.html',
    icon:'<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>' },
  { id:'cxc',          label:'Por Cobrar',         href:'../cxc/cxc.html',
    icon:'<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>' },
  { id:'compras',      label:'Compras',            href:'../compras/compras.html',
    icon:'<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>' },
  { id:'finanzas',     label:'Finanzas',           href:'../finanzas/finanzas.html',
    icon:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
  { id:'alertas',      label:'Alertas',            href:'../alertas/alertas.html',
    icon:'<path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>' },
  { id:'contador',     label:'Vista Contador',     href:'../contador/contador.html',
    icon:'<path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>' },
  { id:'ajustes',      label:'Ajustes',            href:'../ajustes/ajustes.html',
    icon:'<circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/>' },
  { id:'audit',        label:'Auditoría',          href:'../audit/audit.html',
    icon:'<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>' },
];

// Módulo que controla cada ítem del sidebar (undefined = siempre visible)
const MODULO_MAP = {
  clientes: 'clientes', ordenes: 'ordenes', productos: 'inventario',
  cotizaciones: 'cotizaciones', pos: 'pos', pedidos: 'pedidos',
  compras: 'compras', facturas: 'facturas', cxc: 'cxc',
  caja: 'caja', garantias: 'garantias', finanzas: 'reportes', alertas: 'alertas',
};

const SG_MODULOS_CACHE_KEY = 'sg_modulos_cache';
const SG_MODULOS_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function cargarModulos() {
  try {
    const raw = localStorage.getItem(SG_MODULOS_CACHE_KEY);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < SG_MODULOS_CACHE_TTL) return data;
    }
    const data = await api.modulos.list();
    localStorage.setItem(SG_MODULOS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch { return null; }
}

function invalidarCacheModulos() {
  localStorage.removeItem(SG_MODULOS_CACHE_KEY);
}

async function buildSidebar(activeId) {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  // Construir con todos los ítems de inmediato (evita flash en carga)
  const renderItems = (items) => {
    nav.innerHTML = items.map(item => `
      <a class="nav-link ${item.id === activeId ? 'active' : ''}"
         data-page="${item.id}" href="${item.href}">
        <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
          ${item.icon}
        </svg>
        ${item.label}
        ${item.badge ? `<span style="font-size:10px;margin-left:auto">${item.badge}</span>` : ''}
      </a>
    `).join('');
  };

  renderItems(NAV_ITEMS);

  // Luego filtrar por módulos activos
  const modulos = await cargarModulos();
  if (modulos) {
    const activoMap = {};
    modulos.forEach(m => { activoMap[m.id] = m.activo; });

    const filtrados = NAV_ITEMS.filter(item => {
      const mod = MODULO_MAP[item.id];
      if (!mod) return true; // sin módulo asignado → siempre visible
      return activoMap[mod] !== false;
    });
    renderItems(filtrados);
    // Re-aplicar permisos por rol después del segundo render (el primero ya fue procesado
    // por Permisos.aplicar() que se dispara 100 ms después de initSidebar)
    if (typeof Permisos !== 'undefined') Permisos.aplicar();
  }

  setTimeout(actualizarBadgeAlertas, 500);
}

async function actualizarBadgeAlertas() {
  try {
    if (!api.isAuthenticated()) return;
    const { total } = await api.alertas.conteo();
    const link = document.querySelector('.nav-link[data-page="alertas"]');
    if (!link) return;
    const prev = link.querySelector('.alerta-badge');
    if (prev) prev.remove();
    if (total > 0) {
      const badge = document.createElement('span');
      badge.className = 'alerta-badge';
      badge.textContent = total > 9 ? '9+' : total;
      badge.style.cssText = 'background:#A32D2D;color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:10px;margin-left:auto;flex-shrink:0;';
      link.style.display = 'flex';
      link.appendChild(badge);
    }
  } catch(_) {}
}
