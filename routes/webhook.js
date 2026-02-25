const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const stripeRouter = require('./stripe');

// ─── Stripe Webhook Handler ───────────────────────────────────────────
module.exports = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('⚠️  STRIPE_WEBHOOK_SECRET not set — skipping signature check');
  }

  let event;
  try {
    event = webhookSecret
      ? stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
      : JSON.parse(req.body.toString());
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const { getLicense, upsertLicense, getLicenseByCustomerId } = stripeRouter;

  console.log(`📨 Webhook: ${event.type}`);

  switch (event.type) {

    // ── Subscription renewed successfully ──────────────────────────
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const record = await getLicenseByCustomerId(customerId);
      if (record) {
        await upsertLicense(record.email, {
          ...record,
          customerId: record.customer_id,
          subscriptionId: record.subscription_id,
          active: true,
        });
        console.log(`✅ Renewal OK: ${record.email}`);
      }
      break;
    }

    // ── Payment failed ─────────────────────────────────────────────
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const record = await getLicenseByCustomerId(customerId);
      if (record) {
        // Optional: disable after N failures
        // await upsertLicense(record.email, { ...record, active: false });
        console.log(`⚠️  Payment failed for: ${record.email}`);
      }
      break;
    }

    // ── Subscription cancelled / expired ───────────────────────────
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customerId = sub.customer;
      const record = await getLicenseByCustomerId(customerId);
      if (record && record.plan === 'monthly') {
        await upsertLicense(record.email, {
          ...record,
          customerId: record.customer_id,
          subscriptionId: record.subscription_id,
          active: false,
        });
        console.log(`❌ Subscription cancelled: ${record.email}`);
      }
      break;
    }

    // ── Subscription updated (plan change, etc.) ───────────────────
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const customerId = sub.customer;
      const record = await getLicenseByCustomerId(customerId);
      if (record) {
        const active = ['active', 'trialing'].includes(sub.status);
        await upsertLicense(record.email, {
          ...record,
          customerId: record.customer_id,
          subscriptionId: record.subscription_id,
          active,
        });
        console.log(`🔄 Subscription updated: ${record.email} → ${sub.status}`);
      }
      break;
    }

    // ── One-time payment completed (lifetime) ─────────────────────
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode === 'payment' && session.payment_status === 'paid') {
        const email = session.customer_details?.email?.toLowerCase();
        if (email) {
          await upsertLicense(email, {
            plan: 'lifetime',
            active: true,
            customerId: session.customer,
            subscriptionId: null,
            activatedAt: new Date().toISOString(),
          });
          console.log(`🏆 Lifetime access granted: ${email}`);
        }
      }
      break;
    }

    default:
      break;
  }

  res.json({ received: true });
};
