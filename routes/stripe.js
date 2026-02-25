const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('./supabase');

// ─── Auto-create Stripe products if price IDs not set ────────────────
let cachedPrices = {
  monthly: process.env.STRIPE_PRICE_MONTHLY || null,
  lifetime: process.env.STRIPE_PRICE_LIFETIME || null,
};

async function ensurePrices() {
  if (cachedPrices.monthly && cachedPrices.lifetime) return;

  console.log('⚙️  Price IDs not configured — auto-creating Stripe products...');

  try {
    const existing = await stripe.products.list({ limit: 20, active: true });

    let monthlyProduct = existing.data.find(p => p.name === 'Pro Monthly');
    let lifetimeProduct = existing.data.find(p => p.name === 'Lifetime Access');

    if (!monthlyProduct) {
      monthlyProduct = await stripe.products.create({ name: 'Pro Monthly', description: 'Full access, cancel anytime.' });
      console.log('✅ Created product: Pro Monthly');
    }

    if (!lifetimeProduct) {
      lifetimeProduct = await stripe.products.create({ name: 'Lifetime Access', description: 'Pay once, use forever.' });
      console.log('✅ Created product: Lifetime Access');
    }

    if (!cachedPrices.monthly) {
      const existingPrices = await stripe.prices.list({ product: monthlyProduct.id, active: true });
      const existing12 = existingPrices.data.find(p => p.unit_amount === 1200 && p.recurring?.interval === 'month');
      if (existing12) {
        cachedPrices.monthly = existing12.id;
      } else {
        const price = await stripe.prices.create({
          product: monthlyProduct.id,
          unit_amount: 1200,
          currency: 'usd',
          recurring: { interval: 'month' },
        });
        cachedPrices.monthly = price.id;
        console.log('✅ Created price: $12/mo →', price.id);
      }
    }

    if (!cachedPrices.lifetime) {
      const existingPrices = await stripe.prices.list({ product: lifetimeProduct.id, active: true });
      const existing49 = existingPrices.data.find(p => p.unit_amount === 4900 && !p.recurring);
      if (existing49) {
        cachedPrices.lifetime = existing49.id;
      } else {
        const price = await stripe.prices.create({
          product: lifetimeProduct.id,
          unit_amount: 4900,
          currency: 'usd',
        });
        cachedPrices.lifetime = price.id;
        console.log('✅ Created price: $49 one-time →', price.id);
      }
    }

    console.log('💰 Prices ready — monthly:', cachedPrices.monthly, '| lifetime:', cachedPrices.lifetime);
  } catch (err) {
    console.error('❌ Could not auto-create Stripe products:', err.message);
  }
}

ensurePrices();

// ─── Supabase License Helpers ─────────────────────────────────────────
async function getLicense(email) {
  if (!email) return null;
  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('email', email.toLowerCase())
    .single();
  
  if (error && error.code !== 'PGRST116') {
    console.error('getLicense error:', error.message);
  }
  return data;
}

async function upsertLicense(email, licenseData) {
  const { data, error } = await supabase
    .from('licenses')
    .upsert({
      email: email.toLowerCase(),
      plan: licenseData.plan,
      active: licenseData.active,
      customer_id: licenseData.customerId,
      subscription_id: licenseData.subscriptionId,
      activated_at: licenseData.activatedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' })
    .select()
    .single();

  if (error) {
    console.error('upsertLicense error:', error.message);
    return null;
  }
  return data;
}

async function getLicenseByCustomerId(customerId) {
  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('customer_id', customerId)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    console.error('getLicenseByCustomerId error:', error.message);
  }
  return data;
}

// ─── POST /api/stripe/checkout ────────────────────────────────────────
router.post('/checkout', async (req, res) => {
  const { plan, email } = req.body;

  if (!['monthly', 'lifetime'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Use "monthly" or "lifetime".' });
  }

  await ensurePrices();

  const priceId = plan === 'monthly' ? cachedPrices.monthly : cachedPrices.lifetime;

  if (!priceId) {
    return res.status(500).json({ error: `Could not find or create price for "${plan}". Check your STRIPE_SECRET_KEY.` });
  }

  try {
    const sessionConfig = {
      mode: plan === 'monthly' ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/?cancelled=true`,
      metadata: { plan },
      allow_promotion_codes: true,
    };

    if (email) sessionConfig.customer_email = email;

    const session = await stripe.checkout.sessions.create(sessionConfig);

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/stripe/verify ─────────────────────────────────────────
router.post('/verify', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer', 'subscription']
    });

    const paid = session.payment_status === 'paid' ||
                 session.subscription?.status === 'active' ||
                 session.subscription?.status === 'trialing';

    if (!paid) {
      return res.status(402).json({ error: 'Payment not completed.' });
    }

    const email = session.customer_details?.email?.toLowerCase() ||
                  session.customer?.email?.toLowerCase();
    const plan = session.metadata?.plan || 'monthly';
    const customerId = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;

    await upsertLicense(email, {
      plan,
      active: true,
      customerId,
      subscriptionId: session.subscription?.id || null,
      activatedAt: new Date().toISOString(),
    });

    console.log(`✅ Access granted: ${email} (${plan})`);

    res.json({
      success: true,
      email,
      plan,
      accessToken: Buffer.from(`${email}:${Date.now()}`).toString('base64'),
    });
  } catch (err) {
    console.error('Verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/stripe/check-access ───────────────────────────────────
router.post('/check-access', async (req, res) => {
  const { email, accessToken } = req.body;

  let resolvedEmail = email?.toLowerCase();
  if (accessToken && !resolvedEmail) {
    try {
      const decoded = Buffer.from(accessToken, 'base64').toString('utf-8');
      resolvedEmail = decoded.split(':')[0];
    } catch(e) {}
  }

  if (!resolvedEmail) return res.status(400).json({ error: 'Provide email or accessToken' });

  const record = await getLicense(resolvedEmail);
  if (record?.active) {
    res.json({ access: true, plan: record.plan, email: resolvedEmail });
  } else {
    res.json({ access: false });
  }
});

// ─── POST /api/stripe/portal ──────────────────────────────────────────
router.post('/portal', async (req, res) => {
  const { email } = req.body;
  const record = await getLicense(email?.toLowerCase());

  if (!record?.customer_id) {
    return res.status(404).json({ error: 'No subscription found for this email.' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: record.customer_id,
      return_url: `${process.env.APP_URL}/app`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Export helpers for webhook ──────────────────────────────────────
router.getLicense = getLicense;
router.upsertLicense = upsertLicense;
router.getLicenseByCustomerId = getLicenseByCustomerId;

module.exports = router;
