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

  const { getLicense, setLicense } = stripeRouter;

  // ─── Helper: find email by customerId from Supabase ───────────────
  async function findEmailByCustomerId(customerId) {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data } = await supabase
      .from('licenses')
      .select('email')
      .eq('customer_id', customerId)
      .single();
    return data?.email || null;
  }

  console.log(`📨 Webhook: ${event.type}`);

  switch (event.type) {

    // ── Subscription renewed successfully ──────────────────────────
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const email = await findEmailByCustomerId(invoice.customer);
      if (email) {
        const record = await getLicense(email);
        await setLicense(email, { ...record, active: true });
        console.log(`✅ Renewal OK: ${email}`);
      }
      break;
    }

    // ── Payment failed ─────────────────────────────────────────────
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const email = await findEmailByCustomerId(invoice.customer);
      if (email) {
        console.log(`⚠️  Payment failed for: ${email}`);
      }
      break;
    }

    // ── Subscription cancelled / expired ───────────────────────────
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const email = await findEmailByCustomerId(sub.customer);
      if (email) {
        const record = await getLicense(email);
        if (record?.plan === 'monthly') {
          await setLicense(email, { ...record, active: false });
          console.log(`❌ Subscription cancelled: ${email}`);
        }
      }
      break;
    }

    // ── Subscription updated ───────────────────────────────────────
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const email = await findEmailByCustomerId(sub.customer);
      if (email) {
        const active = ['active', 'trialing'].includes(sub.status);
        const record = await getLicense(email);
        await setLicense(email, { ...record, active });
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
          await setLicense(email, {
            plan: 'lifetime',
            active: true,
            customer_id: session.customer,
            subscription_id: null,
            activated_at: new Date().toISOString(),
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
