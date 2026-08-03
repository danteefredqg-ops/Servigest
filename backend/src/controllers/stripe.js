const db = require('../db/connection');

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe no configurado. Agrega STRIPE_SECRET_KEY en Railway.');
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Plan name in DB → Stripe Price ID env var
const PLAN_PRICE = {
  basico:      () => process.env.STRIPE_PRICE_BASICO,
  profesional: () => process.env.STRIPE_PRICE_PRO,
  enterprise:  () => process.env.STRIPE_PRICE_ENTERPRISE,
};

const PLAN_LABEL = {
  basico:      'Plan Básico',
  profesional: 'Plan Pro',
  enterprise:  'Plan Enterprise',
};

// GET /api/stripe/status
async function getPlanStatus(req, res) {
  res.json({
    plan:              req.user.plan,
    plan_vence:        req.user.plan_vence || null,
    modo:              req.user.modo_lectura ? 'lectura' : 'activo',
    tiene_suscripcion: req.user.tiene_suscripcion || false,
  });
}

// POST /api/stripe/checkout  { plan: 'basico'|'profesional'|'enterprise' }
async function createCheckoutSession(req, res, next) {
  try {
    const stripe = getStripe();
    const { plan } = req.body;

    if (!PLAN_PRICE[plan]) {
      return res.status(400).json({ error: 'Plan inválido. Usa: basico, profesional o enterprise' });
    }
    const priceId = PLAN_PRICE[plan]();
    if (!priceId) {
      return res.status(500).json({ error: `Variable STRIPE_PRICE_${plan.toUpperCase()} no configurada en Railway` });
    }

    // Obtener o crear customer de Stripe
    const { rows } = await db.query(
      'SELECT stripe_customer_id, nombre FROM empresas WHERE id = $1',
      [req.user.empresa_id]
    );
    const empresa = rows[0];
    let customerId = empresa?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name:     empresa?.nombre || 'Cliente ServiGest',
        metadata: { empresa_id: req.user.empresa_id },
      });
      customerId = customer.id;
      await db.query(
        'UPDATE empresas SET stripe_customer_id = $1 WHERE id = $2',
        [customerId, req.user.empresa_id]
      );
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://danteefredqg-ops.github.io/Servigest';

    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      success_url:          `${frontendUrl}/pages/ajustes/ajustes.html?plan_activado=1`,
      cancel_url:           `${frontendUrl}/pages/ajustes/ajustes.html`,
      allow_promotion_codes: true,
      metadata:             { empresa_id: req.user.empresa_id, plan },
      subscription_data:    { metadata: { empresa_id: req.user.empresa_id, plan } },
    });

    res.json({ url: session.url });
  } catch (err) { next(err); }
}

// POST /api/stripe/portal  → link al portal de facturación de Stripe
async function getPortalSession(req, res, next) {
  try {
    const stripe = getStripe();
    const { rows } = await db.query(
      'SELECT stripe_customer_id FROM empresas WHERE id = $1',
      [req.user.empresa_id]
    );
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return res.status(400).json({ error: 'Sin suscripción activa. Activa un plan primero.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://danteefredqg-ops.github.io/Servigest';
    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${frontendUrl}/pages/ajustes/ajustes.html`,
    });

    res.json({ url: session.url });
  } catch (err) { next(err); }
}

// POST /api/stripe/webhook  (raw body — montado antes de express.json en app.js)
async function handleWebhook(req, res) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[STRIPE] STRIPE_WEBHOOK_SECRET no configurado — webhook ignorado');
    return res.json({ received: true });
  }

  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[STRIPE] Firma de webhook inválida:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  const obj = event.data.object;

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const empresaId = obj.metadata?.empresa_id;
        const plan      = obj.metadata?.plan;
        const subId     = obj.subscription;
        if (!empresaId || !plan || !subId) break;

        const sub      = await stripe.subscriptions.retrieve(subId);
        const planVence = new Date(sub.current_period_end * 1000);

        await db.query(
          `UPDATE empresas
           SET plan = $1, stripe_subscription_id = $2, plan_vence = $3
           WHERE id = $4`,
          [plan, subId, planVence, empresaId]
        );
        console.log(`[STRIPE] Plan ${plan} activado para empresa ${empresaId} — vence ${planVence.toISOString()}`);
        break;
      }

      case 'invoice.paid': {
        // Renovación mensual: extender plan_vence
        const subId = obj.subscription;
        if (!subId) break;

        const sub       = await stripe.subscriptions.retrieve(subId);
        const empresaId = sub.metadata?.empresa_id;
        const plan      = sub.metadata?.plan;
        if (!empresaId) break;

        const planVence = new Date(sub.current_period_end * 1000);
        await db.query(
          'UPDATE empresas SET plan = $1, plan_vence = $2 WHERE id = $3',
          [plan, planVence, empresaId]
        );
        console.log(`[STRIPE] Renovación ${plan} para empresa ${empresaId} — vence ${planVence.toISOString()}`);
        break;
      }

      case 'customer.subscription.updated': {
        // Cambio de plan (upgrade/downgrade)
        const empresaId = obj.metadata?.empresa_id;
        const plan      = obj.metadata?.plan;
        if (!empresaId || !plan) break;

        const planVence = new Date(obj.current_period_end * 1000);
        await db.query(
          'UPDATE empresas SET plan = $1, plan_vence = $2 WHERE id = $3',
          [plan, planVence, empresaId]
        );
        break;
      }

      case 'customer.subscription.deleted': {
        // Suscripción cancelada → modo lectura inmediato
        const empresaId = obj.metadata?.empresa_id;
        if (!empresaId) break;

        await db.query(
          'UPDATE empresas SET plan_vence = NOW() WHERE id = $1',
          [empresaId]
        );
        console.log(`[STRIPE] Suscripción cancelada para empresa ${empresaId} — modo lectura activo`);
        break;
      }

      case 'invoice.payment_failed':
        // Stripe reintenta automáticamente; subscription.deleted dispara cuando se agota
        console.log(`[STRIPE] Pago fallido para subscription ${obj.subscription}`);
        break;
    }
  } catch (err) {
    console.error('[STRIPE] Error procesando evento', event.type, ':', err.message);
  }

  res.json({ received: true });
}

module.exports = { getPlanStatus, createCheckoutSession, getPortalSession, handleWebhook };
