-- ServiGest — Schema PostgreSQL v2
-- Ejecutar: npm run db:migrate

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── ENUMs ────────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE estado_pedido      AS ENUM ('pendiente','en_camino','entregado','cancelado');       EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE estado_cotizacion  AS ENUM ('borrador','enviada','aceptada','rechazada');            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE estado_cfdi        AS ENUM ('borrador','timbrado','cancelado');                     EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE estado_compra      AS ENUM ('pendiente','recibida','cancelada');                    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE estado_cxc         AS ENUM ('pendiente','parcial','pagada','vencida');              EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE plan_suscripcion   AS ENUM ('trial','basico','profesional','enterprise');            EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── EMPRESAS (multiempresa real) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          VARCHAR(200) NOT NULL,
  rfc             VARCHAR(13),
  regimen_fiscal  VARCHAR(100),
  direccion_fiscal TEXT,
  cp              VARCHAR(10),
  plan            plan_suscripcion NOT NULL DEFAULT 'trial',
  trial_hasta     TIMESTAMPTZ,
  facturapi_key   VARCHAR(255),           -- API key de Facturapi por empresa
  logo_url        VARCHAR(500),
  activa          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── USUARIOS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre        VARCHAR(120) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol           VARCHAR(20) NOT NULL DEFAULT 'admin',   -- admin | operador | readonly
  onboarding_ok BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_empresa ON usuarios(empresa_id);

-- ── CLIENTES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre         VARCHAR(200) NOT NULL,
  rfc            VARCHAR(13),
  uso_cfdi       VARCHAR(10) DEFAULT 'G03',
  regimen_fiscal VARCHAR(100),
  telefono       VARCHAR(20),
  email          VARCHAR(255),
  direccion      TEXT,
  notas          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clientes_empresa ON clientes(empresa_id);

-- ── PRODUCTOS / INVENTARIO ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre        VARCHAR(200) NOT NULL,
  descripcion   TEXT,
  sku           VARCHAR(80),
  unidad        VARCHAR(30) DEFAULT 'servicio',   -- pieza, caja, servicio, hora, etc.
  clave_sat     VARCHAR(20) DEFAULT '84111500',   -- clave producto/servicio SAT
  precio        NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo         NUMERIC(12,2) DEFAULT 0,
  stock         INTEGER DEFAULT 0,
  stock_minimo  INTEGER DEFAULT 0,
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_productos_empresa ON productos(empresa_id);

-- ── PEDIDOS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pedidos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero         SERIAL,
  cliente_id     UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  descripcion    TEXT,
  subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
  impuestos      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total          NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado         estado_pedido NOT NULL DEFAULT 'pendiente',
  fecha_servicio TIMESTAMPTZ,
  notas          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_empresa  ON pedidos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado   ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente  ON pedidos(cliente_id);

-- ── ITEMS DE PEDIDO ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pedido_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES productos(id) ON DELETE SET NULL,
  descripcion VARCHAR(300) NOT NULL,
  cantidad    NUMERIC(10,2) NOT NULL DEFAULT 1,
  precio_unit NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento   NUMERIC(5,2) NOT NULL DEFAULT 0,
  subtotal    NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_items_pedido ON pedido_items(pedido_id);

-- ── COTIZACIONES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cotizaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cliente_id  UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  items       JSONB NOT NULL DEFAULT '[]',
  subtotal    NUMERIC(12,2) NOT NULL DEFAULT 0,
  impuestos   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado      estado_cotizacion NOT NULL DEFAULT 'borrador',
  notas       TEXT,
  valida_hasta DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_empresa ON cotizaciones(empresa_id);

-- ── CFDI / FACTURAS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facturas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  pedido_id       UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  facturapi_id    VARCHAR(100),              -- ID en Facturapi
  folio           VARCHAR(20),
  serie           VARCHAR(10) DEFAULT 'A',
  uuid_sat        VARCHAR(50),               -- UUID del timbre fiscal
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  impuestos       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado          estado_cfdi NOT NULL DEFAULT 'borrador',
  pdf_url         VARCHAR(500),
  xml_url         VARCHAR(500),
  items           JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facturas_empresa ON facturas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente ON facturas(cliente_id);

-- ── CUENTAS POR COBRAR ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuentas_por_cobrar (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cliente_id    UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  pedido_id     UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  factura_id    UUID REFERENCES facturas(id) ON DELETE SET NULL,
  monto         NUMERIC(12,2) NOT NULL,
  monto_pagado  NUMERIC(12,2) NOT NULL DEFAULT 0,
  fecha_vence   DATE NOT NULL,
  estado        estado_cxc NOT NULL DEFAULT 'pendiente',
  notas         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cxc_empresa ON cuentas_por_cobrar(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cxc_estado  ON cuentas_por_cobrar(estado);

-- ── PAGOS DE CXC ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagos_cxc (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cxc_id   UUID NOT NULL REFERENCES cuentas_por_cobrar(id) ON DELETE CASCADE,
  monto    NUMERIC(12,2) NOT NULL,
  metodo   VARCHAR(40) DEFAULT 'efectivo',  -- efectivo, transferencia, tarjeta
  referencia VARCHAR(100),
  fecha    DATE NOT NULL DEFAULT CURRENT_DATE,
  notas    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CATÁLOGO DE SERVICIOS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS servicios_catalogo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre      VARCHAR(200) NOT NULL,
  categoria   VARCHAR(100),
  precio_base NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servicios_empresa ON servicios_catalogo(empresa_id);

-- ── COMPRAS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compras (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  proveedor    VARCHAR(200) NOT NULL,
  descripcion  TEXT,
  items        JSONB NOT NULL DEFAULT '[]',
  total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado       estado_compra NOT NULL DEFAULT 'pendiente',
  fecha_entrega DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compras_empresa ON compras(empresa_id);

-- ── VISTA: vencer CXC automáticamente ───────────────────────────────────────
-- (correr como cron o trigger periódico)
-- UPDATE cuentas_por_cobrar SET estado = 'vencida'
-- WHERE estado = 'pendiente' AND fecha_vence < CURRENT_DATE;

-- ── LOGS DE AUDITORÍA ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre VARCHAR(120),          -- guardado por si el usuario se elimina
  accion      VARCHAR(80) NOT NULL,     -- 'crear_pedido', 'cancelar_factura', etc.
  entidad     VARCHAR(40) NOT NULL,     -- 'pedido', 'factura', 'cliente', etc.
  entidad_id  UUID,                     -- ID del registro afectado
  detalle     JSONB DEFAULT '{}',       -- datos extra (antes/después, montos, etc.)
  ip          VARCHAR(45),              -- IPv4 o IPv6
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_empresa    ON audit_logs(empresa_id);
CREATE INDEX IF NOT EXISTS idx_audit_usuario    ON audit_logs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_accion     ON audit_logs(accion);

-- ── ÓRDENES DE TRABAJO ───────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE estado_ot AS ENUM ('recibida','en_proceso','en_espera','terminada','entregada','cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ordenes_trabajo (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero          SERIAL,
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  tecnico_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  descripcion     TEXT NOT NULL,           -- qué le pasa a la máquina
  equipo          VARCHAR(200),            -- nombre/modelo del equipo
  num_serie       VARCHAR(100),            -- número de serie
  estado          estado_ot NOT NULL DEFAULT 'recibida',
  prioridad       VARCHAR(20) DEFAULT 'normal', -- baja, normal, alta, urgente
  fecha_prometida DATE,                    -- cuándo prometemos tenerla lista
  notas_tecnico   TEXT,                    -- notas internas del técnico
  notas_entrega   TEXT,                    -- notas para el cliente al entregar
  subtotal        NUMERIC(12,2) DEFAULT 0,
  impuestos       NUMERIC(12,2) DEFAULT 0,
  total           NUMERIC(12,2) DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ot_empresa  ON ordenes_trabajo(empresa_id);
CREATE INDEX IF NOT EXISTS idx_ot_estado   ON ordenes_trabajo(estado);
CREATE INDEX IF NOT EXISTS idx_ot_tecnico  ON ordenes_trabajo(tecnico_id);
CREATE INDEX IF NOT EXISTS idx_ot_cliente  ON ordenes_trabajo(cliente_id);

-- ── ITEMS DE ORDEN DE TRABAJO ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE tipo_item_ot AS ENUM ('refaccion','consumible','mano_obra');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ot_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ot_id       UUID NOT NULL REFERENCES ordenes_trabajo(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES productos(id) ON DELETE SET NULL,
  tipo        tipo_item_ot NOT NULL DEFAULT 'refaccion',
  descripcion VARCHAR(300) NOT NULL,
  cantidad    NUMERIC(10,2) NOT NULL DEFAULT 1,
  precio_unit NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_unit  NUMERIC(12,2) DEFAULT 0,     -- costo interno (consumibles)
  subtotal    NUMERIC(12,2) NOT NULL DEFAULT 0,
  facturar    BOOLEAN NOT NULL DEFAULT true, -- consumibles = false
  disponible  BOOLEAN NOT NULL DEFAULT true  -- false = hay que comprar
);

CREATE INDEX IF NOT EXISTS idx_ot_items_ot ON ot_items(ot_id);

-- ── ALERTAS INTERNAS ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE tipo_alerta AS ENUM ('falta_pieza','aprobacion','completado','info');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS alertas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  ot_id         UUID REFERENCES ordenes_trabajo(id) ON DELETE CASCADE,
  de_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  para_rol      VARCHAR(20) DEFAULT 'admin',  -- a qué rol va la alerta
  tipo          tipo_alerta NOT NULL DEFAULT 'info',
  titulo        VARCHAR(200) NOT NULL,
  mensaje       TEXT,
  leida         BOOLEAN NOT NULL DEFAULT false,
  resuelta      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alertas_empresa  ON alertas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_alertas_rol      ON alertas(para_rol);
CREATE INDEX IF NOT EXISTS idx_alertas_leida    ON alertas(leida);
CREATE INDEX IF NOT EXISTS idx_alertas_ot       ON alertas(ot_id);

-- ── GARANTÍAS ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE estado_garantia AS ENUM ('activa','vencida','reclamada','anulada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS garantias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  ot_id        UUID REFERENCES ordenes_trabajo(id) ON DELETE SET NULL,
  cliente_id   UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  equipo       VARCHAR(200),
  num_serie    VARCHAR(100),
  descripcion  TEXT NOT NULL,
  fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin    DATE NOT NULL,
  estado       estado_garantia NOT NULL DEFAULT 'activa',
  notas        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_garantias_empresa ON garantias(empresa_id);
CREATE INDEX IF NOT EXISTS idx_garantias_cliente ON garantias(cliente_id);
CREATE INDEX IF NOT EXISTS idx_garantias_estado  ON garantias(estado);

-- ── COLUMNAS ADICIONALES (idempotentes) ──────────────────────────────────────
ALTER TABLE productos        ADD COLUMN IF NOT EXISTS proveedor      VARCHAR(200);
ALTER TABLE productos        ADD COLUMN IF NOT EXISTS fecha_compra   DATE;
ALTER TABLE cotizaciones     ADD COLUMN IF NOT EXISTS ot_id          UUID REFERENCES ordenes_trabajo(id) ON DELETE SET NULL;
ALTER TABLE pedidos          ADD COLUMN IF NOT EXISTS forma_pago     VARCHAR(30) DEFAULT 'por_definir';
ALTER TABLE ordenes_trabajo  ADD COLUMN IF NOT EXISTS tipo_equipo    VARCHAR(100);
ALTER TABLE ordenes_trabajo  ADD COLUMN IF NOT EXISTS modelo         VARCHAR(100);
ALTER TABLE ordenes_trabajo  ADD COLUMN IF NOT EXISTS foto_entrada   TEXT;
ALTER TABLE ordenes_trabajo  ADD COLUMN IF NOT EXISTS cotizacion_json JSONB;

-- ── HISTORIAL DE PRECIOS DE COMPRA ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS historial_precios_compra (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  precio      NUMERIC(12,2) NOT NULL,
  proveedor   VARCHAR(200),
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hist_precios_producto ON historial_precios_compra(producto_id);
CREATE INDEX IF NOT EXISTS idx_hist_precios_empresa  ON historial_precios_compra(empresa_id);

-- ── MÓDULOS POR EMPRESA ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modulos_config (
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  modulo      VARCHAR(50) NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (empresa_id, modulo)
);

-- Activar todos los módulos para empresas existentes que no tengan config
INSERT INTO modulos_config (empresa_id, modulo, activo)
SELECT e.id, m.modulo, true
FROM empresas e
CROSS JOIN (VALUES
  ('clientes'),('ordenes'),('inventario'),('cotizaciones'),
  ('pos'),('pedidos'),('compras'),('facturas'),('cxc'),
  ('caja'),('garantias'),('reportes'),('alertas')
) AS m(modulo)
ON CONFLICT (empresa_id, modulo) DO NOTHING;

-- ── MIGRACIONES INCREMENTALES ─────────────────────────────────────────────────
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS reset_token         TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
