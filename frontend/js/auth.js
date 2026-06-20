// auth.js — utilidades de sesión, permisos y UI compartida

// ── Autenticación ─────────────────────────────────────────────────────────────
function getAppRoot() {
  const path = window.location.pathname;
  const idx  = path.indexOf('/pages/');
  return idx >= 0 ? path.substring(0, idx) : '';
}

function requireAuth() {
  if (!api.isAuthenticated()) {
    window.location.href = getAppRoot() + '/pages/auth/login.html';
  }
}

// ── Timeout de sesión por inactividad ────────────────────────────────────────
(function initSessionTimeout() {
  const mins = parseInt(localStorage.getItem('sg_session_timeout') ?? '60');
  if (!mins) return; // 0 = nunca cerrar

  let logoutTimer;
  let warnTimer;
  let warnEl;

  function mostrarAviso() {
    if (warnEl) return;
    warnEl = document.createElement('div');
    warnEl.id = 'sg-inactivity-warn';
    warnEl.style.cssText = [
      'position:fixed;bottom:80px;right:1.5rem;z-index:9998;',
      'background:#854F0B;color:#fff;padding:14px 18px;border-radius:10px;',
      'font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.25);',
      'display:flex;align-items:center;gap:12px;max-width:320px;',
    ].join('');
    warnEl.innerHTML = `
      <span>⚠ Tu sesión cerrará en 1 minuto por inactividad</span>
      <button onclick="sgResetTimeout()" style="
        background:rgba(255,255,255,.2);border:none;color:#fff;padding:4px 10px;
        border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap
      ">Seguir activo</button>`;
    document.body.appendChild(warnEl);
  }

  function ocultarAviso() {
    if (warnEl) { warnEl.remove(); warnEl = null; }
  }

  function reset() {
    clearTimeout(logoutTimer);
    clearTimeout(warnTimer);
    ocultarAviso();

    if (mins > 1) {
      warnTimer = setTimeout(mostrarAviso, (mins - 1) * 60_000);
    }
    logoutTimer = setTimeout(() => {
      ocultarAviso();
      api.logout();
    }, mins * 60_000);
  }

  window.sgResetTimeout = reset;

  ['mousemove','keydown','click','touchstart','scroll'].forEach(ev =>
    document.addEventListener(ev, reset, { passive: true })
  );

  reset();
})();

// ── Sidebar con datos del usuario ────────────────────────────────────────────
function initSidebar(activeId) {
  if (typeof buildSidebar === 'function') buildSidebar(activeId);

  const user = api.getUser();
  if (!user) return;

  const initials = user.nombre
    ? user.nombre.split(' ').slice(0,2).map(n=>n[0]).join('').toUpperCase()
    : '?';

  const avatarEl  = document.querySelector('.user-avatar');
  const nameEl    = document.querySelector('.user-name');
  const empresaEl = document.querySelector('.user-empresa');

  if (avatarEl)  avatarEl.textContent  = initials;
  if (nameEl)    nameEl.textContent    = user.nombre || 'Usuario';
  if (empresaEl) empresaEl.textContent = user.empresa_nombre || '';

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', () => api.logout());

  setTimeout(() => Permisos.aplicar(), 100);
}

// ── Toast de notificación ─────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;cursor:pointer;font-size:16px;margin-left:10px;opacity:.7">✕</button>
  `;
  toast.style.cssText = `
    display:flex; align-items:center; justify-content:space-between;
    padding:12px 16px; border-radius:8px; font-size:13px; font-weight:500;
    color:#fff; animation:slideIn .2s ease; min-width:280px; max-width:400px;
    box-shadow:0 4px 12px rgba(0,0,0,.15);
    background:${type === 'error' ? '#A32D2D' : type === 'warning' ? '#854F0B' : '#0F6E56'};
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── Botón con estado de carga ─────────────────────────────────────────────────
function setBtnLoading(btnId, loading, texto = null) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (loading) {
    btn._textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span style="opacity:.6">⏳ ${texto || 'Guardando...'}</span>`;
  } else {
    btn.disabled = false;
    btn.textContent = texto || btn._textoOriginal || 'Guardar';
  }
}

// ── Modales ───────────────────────────────────────────────────────────────────
function openModal(id)  {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); el.style.display = 'flex'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('open'); el.style.display = 'none'; }
}

// Cerrar modal con Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => {
      m.classList.remove('open');
      m.style.display = 'none';
    });
  }
});

// ── Formateo ──────────────────────────────────────────────────────────────────
function formatMoney(amount) {
  const n = Number(amount) || 0;
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 0,
  }).format(n);
}

function formatDate(isoString) {
  if (!isoString) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(isoString));
}

function estadoBadge(estado) {
  const cfg = {
    pendiente:  { label:'Pendiente',   cls:'badge-pendiente' },
    en_camino:  { label:'En camino',   cls:'badge-en_camino' },
    entregado:  { label:'Entregado',   cls:'badge-entregado' },
    cancelado:  { label:'Cancelado',   cls:'badge-cancelado' },
    borrador:   { label:'Borrador',    cls:'badge-borrador' },
    enviada:    { label:'Enviada',     cls:'badge-enviada' },
    aceptada:   { label:'Aceptada',    cls:'badge-aceptada' },
    rechazada:  { label:'Rechazada',   cls:'badge-rechazada' },
    recibida:   { label:'Recibida',    cls:'badge-borrador' },
    en_proceso: { label:'En proceso',  cls:'badge-en_camino' },
    en_espera:  { label:'En espera',   cls:'badge-pendiente' },
    terminada:  { label:'Terminada',   cls:'badge-aceptada' },
    entregada:  { label:'Entregada',   cls:'badge-entregado' },
    pagada:     { label:'Pagada',      cls:'badge-entregado' },
    parcial:    { label:'Pago parcial',cls:'badge-pendiente' },
    vencida:    { label:'Vencida',     cls:'badge-cancelado' },
  };
  const c = cfg[estado] || { label: estado, cls: 'badge-borrador' };
  return `<span class="badge ${c.cls}">${c.label}</span>`;
}

// ── Sistema de permisos ───────────────────────────────────────────────────────
const Permisos = {
  reglas: {
    superadmin: { todo: true },
    admin: {
      eliminar:true, editarPrecios:true, cancelarFacturas:true,
      verCostos:true, verFinanzas:true, verCompras:true,
      gestionarUsuarios:true, verCxC:true, timbrarFacturas:true,
    },
    operador: {
      eliminar:false, editarPrecios:false, cancelarFacturas:false,
      verCostos:false, verFinanzas:false, verCompras:false,
      gestionarUsuarios:false, verCxC:false, timbrarFacturas:false,
    },
    contador: {
      eliminar:false, editarPrecios:false, cancelarFacturas:false,
      verCostos:true, verFinanzas:true, verCompras:false,
      gestionarUsuarios:false, verCxC:true, timbrarFacturas:true,
    },
  },

  getRol() { return api.getUser()?.rol || 'operador'; },

  puede(accion) {
    const rol = this.getRol();
    if (rol === 'superadmin') return true;
    return this.reglas[rol]?.[accion] ?? false;
  },

  aplicar() {
    document.querySelectorAll('[data-permiso]').forEach(el => {
      if (!this.puede(el.dataset.permiso)) el.style.display = 'none';
    });

    const rol = this.getRol();
    const ocultar = {
      operador: ['finanzas','compras','cxc','contador','audit'],
      contador:  ['compras','productos','audit','ordenes'],
    };
    (ocultar[rol] || []).forEach(page => {
      const link = document.querySelector(`.nav-link[data-page="${page}"]`);
      if (link) link.style.display = 'none';
    });
  },

  requierePode(accion) {
    if (!this.puede(accion)) {
      showToast('No tienes permiso para acceder a esta sección', 'error');
      setTimeout(() => window.location.href = '../dashboard/dashboard.html', 1500);
      return false;
    }
    return true;
  },
};

// Agregar animación CSS para toasts si no existe
if (!document.getElementById('sg-toast-style')) {
  const style = document.createElement('style');
  style.id = 'sg-toast-style';
  style.textContent = `
    .toast-container { position:fixed; bottom:1.5rem; right:1.5rem; z-index:9999; display:flex; flex-direction:column; gap:8px; }
    @keyframes slideIn { from { transform:translateX(20px); opacity:0; } to { transform:translateX(0); opacity:1; } }
  `;
  document.head.appendChild(style);
}
