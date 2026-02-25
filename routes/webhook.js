const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const stripeRouter = require('./stripe');

// ─── Stripe Webhook Handler ───────────────────────────────────────────
// Handles async events: subscription cancellations, renewals, failures
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

  const licenses = stripeRouter.licenses;

  // ─── Helper: find email from customerId ───────────────────────────
  function findEmailByCustomerId(customerId) {
    for (const [email, record] of licenses.entries()) {
      if (record.customerId === customerId) return email;
    }
    return null;
  }

  console.log(`📨 Webhook: ${event.type}`);

  switch (event.type) {

    // ── Subscription renewed successfully ──────────────────────────
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const email = findEmailByCustomerId(customerId);
      if (email) {
        const record = licenses.get(email);
        licenses.set(email, { ...record, active: true });
        console.log(`✅ Renewal OK: ${email}`);
      }
      break;
    }

    // ── Payment failed — could disable access or send dunning email ─
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const email = findEmailByCustomerId(customerId);
      if (email) {
        // Optional: disable after N failures. Here we just log.
        // const record = licenses.get(email);
        // licenses.set(email, { ...record, active: false });
        console.log(`⚠️  Payment failed for: ${email}`);
      }
      break;
    }

    // ── Subscription cancelled / expired ───────────────────────────
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customerId = sub.customer;
      const email = findEmailByCustomerId(customerId);
      if (email) {
        const record = licenses.get(email);
        if (record?.plan === 'monthly') {
          licenses.set(email, { ...record, active: false });
          console.log(`❌ Subscription cancelled: ${email}`);
        }
        // Lifetime payers keep access even if somehow sub object is deleted
      }
      break;
    }

    // ── Subscription updated (plan change, etc.) ───────────────────
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const customerId = sub.customer;
      const email = findEmailByCustomerId(customerId);
      if (email) {
        const active = ['active', 'trialing'].includes(sub.status);
        const record = licenses.get(email);
        licenses.set(email, { ...record, active });
        console.log(`🔄 Subscription updated: ${email} → ${sub.status}`);
      }
      break;
    }

    // ── One-time payment completed (lifetime) ─────────────────────
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode === 'payment' && session.payment_status === 'paid') {
        const email = session.customer_details?.email?.toLowerCase();
        if (email) {
          licenses.set(email, {
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
      // Unhandled event type — safe to ignore
      break;
  }

  res.json({ received: true });
};
