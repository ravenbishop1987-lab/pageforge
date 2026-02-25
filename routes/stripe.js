const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ─── In-memory license store ──────────────────────────────────────────
// In production, replace with a real DB (Postgres, MongoDB, etc.)
// Key: email → { plan: 'monthly'|'lifetime', active: bool, customerId, subscriptionId }
const licenses = new Map();

// ─── Helper: check if email has active access ─────────────────────────
function hasAccess(email) {
  const record = licenses.get(email?.toLowerCase());
  if (!record) return false;
  return record.active === true;
}

// ─── POST /api/stripe/checkout ────────────────────────────────────────
// Creates a Stripe Checkout session and returns the URL
router.post('/checkout', async (req, res) => {
  const { plan, email } = req.body;

  if (!['monthly', 'lifetime'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Use "monthly" or "lifetime".' });
  }

  const priceId = plan === 'monthly'
    ? process.env.STRIPE_PRICE_MONTHLY
    : process.env.STRIPE_PRICE_LIFETIME;

  if (!priceId) {
    return res.status(500).json({ error: `Price ID for "${plan}" not configured in .env` });
  }

  try {
    const sessionConfig = {
      mode: plan === 'monthly' ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/?cancelled=true`,
      metadata: { plan },
      allow_promotion_codes: true,
    };

    // Pre-fill email if provided
    if (email) sessionConfig.customer_email = email;

    const session = await stripe.checkout.sessions.create(sessionConfig);

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/stripe/verify ─────────────────────────────────────────
// Called after redirect from Stripe to verify payment & issue access
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

    // Store license
    licenses.set(email, {
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
      // Return a simple token (email:timestamp signed in prod — use JWT for real apps)
      accessToken: Buffer.from(`${email}:${Date.now()}`).toString('base64'),
    });
  } catch (err) {
    console.error('Verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/stripe/check-access ───────────────────────────────────
// Quick check: does this email/token have active access?
router.post('/check-access', (req, res) => {
  const { email, accessToken } = req.body;

  // Token-based check (decode email from token)
  let resolvedEmail = email?.toLowerCase();
  if (accessToken && !resolvedEmail) {
    try {
      const decoded = Buffer.from(accessToken, 'base64').toString('utf-8');
      resolvedEmail = decoded.split(':')[0];
    } catch(e) {}
  }

  if (!resolvedEmail) return res.status(400).json({ error: 'Provide email or accessToken' });

  const record = licenses.get(resolvedEmail);
  if (record?.active) {
    res.json({ access: true, plan: record.plan, email: resolvedEmail });
  } else {
    res.json({ access: false });
  }
});

// ─── POST /api/stripe/portal ──────────────────────────────────────────
// Creates a Stripe Customer Portal session for managing subscriptions
router.post('/portal', async (req, res) => {
  const { email } = req.body;
  const record = licenses.get(email?.toLowerCase());

  if (!record?.customerId) {
    return res.status(404).json({ error: 'No subscription found for this email.' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: record.customerId,
      return_url: `${process.env.APP_URL}/app`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Export license store so webhook can update it ───────────────────
router.licenses = licenses;

module.exports = router;
