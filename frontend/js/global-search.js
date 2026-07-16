// global-search.js — Búsqueda global Ctrl+K para ServiGest
(function() {
  const ROOT = (function() {
    const path = window.location.pathname;
    const idx  = path.indexOf('/pages/');
    return idx >= 0 ? path.substring(0, idx) : '';
  })();

  const LINKS = {
    clientes: ROOT + '/pages/clientes/clientes.html',
    productos: ROOT + '/pages/productos/productos.html',
    ordenes:   ROOT + '/pages/ordenes/ordenes.html',
  };

  let overlay, input, results, debounceTimer;

  function buildOverlay() {
    if (document.getElementById('sg-search-overlay')) return;
    overlay = document.createElement('div');
    overlay.id = 'sg-search-overlay';
    overlay.style.cssText = [
      'display:none;position:fixed;inset:0;z-index:9990;',
      'background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);',
      'align-items:flex-start;justify-content:center;padding-top:10vh;',
    ].join('');

    overlay.innerHTML = `
      <div id="sg-search-box" style="
        background:var(--color-bg);border:1px solid var(--color-border-md);
        border-radius:16px;width:100%;max-width:560px;box-shadow:var(--shadow-lg);
        overflow:hidden;
      ">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--color-border)">
          <svg width="18" height="18" fill="none" stroke="var(--color-text-muted)" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input id="sg-search-input" placeholder="Buscar clientes, productos, órdenes..."
            style="flex:1;border:none;outline:none;font-size:15px;background:transparent;color:var(--color-text);font-family:inherit;"
          />
          <kbd style="font-size:11px;color:var(--color-text-hint);background:var(--color-bg-tertiary);
            padding:2px 7px;border-radius:5px;font-family:monospace">Esc</kbd>
        </div>
        <div id="sg-search-results" style="max-height:420px;overflow-y:auto;padding:8px 0;">
          <div style="padding:16px 18px;font-size:13px;color:var(--color-text-hint)">
            Escribe para buscar en clientes, productos y órdenes de trabajo...
          </div>
        </div>
        <div style="padding:10px 18px;border-top:1px solid var(--color-border);display:flex;gap:16px;font-size:11px;color:var(--color-text-hint)">
          <span>↑↓ navegar</span><span>↵ abrir</span><span>Esc cerrar</span>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    input   = document.getElementById('sg-search-input');
    results = document.getElementById('sg-search-results');

    overlay.addEventListener('click', e => {
      if (!document.getElementById('sg-search-box').contains(e.target)) closeSearch();
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeSearch(); return; }
      if (e.key === 'ArrowDown') { moveFocus(1); e.preventDefault(); return; }
      if (e.key === 'ArrowUp')   { moveFocus(-1); e.preventDefault(); return; }
      if (e.key === 'Enter') {
        const focused = results.querySelector('.sg-result-item:focus,.sg-result-item[data-focused]');
        if (focused) focused.click();
      }
    });

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => doSearch(input.value.trim()), 280);
    });
  }

  function openSearch() {
    buildOverlay();
    overlay.style.display = 'flex';
    setTimeout(() => input.focus(), 50);
  }

  function closeSearch() {
    if (overlay) overlay.style.display = 'none';
    if (input)   input.value = '';
    if (results) results.innerHTML = '<div style="padding:16px 18px;font-size:13px;color:var(--color-text-hint)">Escribe para buscar en clientes, productos y órdenes de trabajo...</div>';
  }

  function moveFocus(dir) {
    const items = [...results.querySelectorAll('.sg-result-item')];
    if (!items.length) return;
    const current = results.querySelector('.sg-result-item[data-focused]');
    let idx = items.indexOf(current) + dir;
    idx = Math.max(0, Math.min(idx, items.length - 1));
    items.forEach(i => delete i.dataset.focused);
    items[idx].dataset.focused = '1';
    items[idx].style.background = 'var(--color-bg-secondary)';
    items[idx].scrollIntoView({ block: 'nearest' });
    items.forEach((item, i) => {
      if (i !== idx) item.style.background = '';
    });
  }

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function resultItem(icon, title, sub, href) {
    return `<a class="sg-result-item" href="${escHtml(href)}" onclick="window.closeGlobalSearch && window.closeGlobalSearch()" style="
      display:flex;align-items:center;gap:12px;padding:10px 18px;text-decoration:none;
      color:var(--color-text);transition:background .1s;cursor:pointer;
    " onmouseenter="this.style.background='var(--color-bg-secondary)'" onmouseleave="this.style.background=''"
    >
      <span style="font-size:18px;width:24px;text-align:center;flex-shrink:0">${icon}</span>
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(title)}</div>
        <div style="font-size:11px;color:var(--color-text-hint);margin-top:1px">${escHtml(sub)}</div>
      </div>
    </a>`;
  }

  function groupHeader(label) {
    return `<div style="padding:6px 18px 4px;font-size:10px;font-weight:600;color:var(--color-text-hint);text-transform:uppercase;letter-spacing:.5px">${label}</div>`;
  }

  async function doSearch(q) {
    if (q.length < 2) {
      results.innerHTML = '<div style="padding:16px 18px;font-size:13px;color:var(--color-text-hint)">Escribe al menos 2 caracteres...</div>';
      return;
    }

    results.innerHTML = '<div style="padding:16px 18px;font-size:13px;color:var(--color-text-hint)">Buscando...</div>';

    try {
      const [clientes, productos, ordenes] = await Promise.allSettled([
        api.get('/clientes?q=' + encodeURIComponent(q) + '&limit=5'),
        api.get('/productos?q=' + encodeURIComponent(q) + '&limit=5'),
        api.get('/ordenes?q=' + encodeURIComponent(q) + '&limit=5'),
      ]);

      let html = '';
      const cl = clientes.status === 'fulfilled' ? clientes.value : [];
      const pr = productos.status === 'fulfilled' ? productos.value : [];
      const or = ordenes.status  === 'fulfilled' ? ordenes.value  : [];

      // Filter locally by query (backend may not support ?q=)
      const qLow = q.toLowerCase();
      const filtCl = (Array.isArray(cl) ? cl : []).filter(c =>
        c.nombre?.toLowerCase().includes(qLow) || c.telefono?.includes(q) || c.email?.toLowerCase().includes(qLow)
      ).slice(0, 5);
      const filtPr = (Array.isArray(pr) ? pr : []).filter(p =>
        p.nombre?.toLowerCase().includes(qLow) || p.sku?.toLowerCase().includes(qLow)
      ).slice(0, 5);
      const filtOr = (Array.isArray(or) ? or : []).filter(o =>
        o.numero?.toString().includes(q) || o.equipo?.toLowerCase().includes(qLow) ||
        o.cliente_nombre?.toLowerCase().includes(qLow)
      ).slice(0, 5);

      if (filtCl.length) {
        html += groupHeader('Clientes');
        filtCl.forEach(c => {
          html += resultItem('👤', c.nombre, c.telefono || c.email || 'Sin contacto', LINKS.clientes);
        });
      }
      if (filtPr.length) {
        html += groupHeader('Productos / Inventario');
        filtPr.forEach(p => {
          html += resultItem('📦', p.nombre, `Stock: ${p.stock ?? '—'} · $${Number(p.precio_venta||0).toFixed(2)}`, LINKS.productos);
        });
      }
      if (filtOr.length) {
        html += groupHeader('Órdenes de Trabajo');
        filtOr.forEach(o => {
          html += resultItem('🔧', `OT-${String(o.numero).padStart(4,'0')} · ${o.cliente_nombre || ''}`, o.equipo || o.tipo_equipo || 'Sin descripción', LINKS.ordenes);
        });
      }

      if (!html) {
        results.innerHTML = `<div style="padding:24px 18px;text-align:center;font-size:13px;color:var(--color-text-hint)">Sin resultados para <strong>"${q}"</strong></div>`;
      } else {
        results.innerHTML = html;
      }
    } catch(err) {
      results.innerHTML = `<div style="padding:16px 18px;font-size:13px;color:#A32D2D">Error en búsqueda: ${err.message}</div>`;
    }
  }

  // Keyboard shortcut global
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
  });

  // Exponer para uso desde botones en el HTML
  window.openGlobalSearch = openSearch;
  window.closeGlobalSearch = closeSearch;
})();
