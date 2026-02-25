require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const stripeRoutes = require('./routes/stripe');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Stripe webhook needs raw body ───────────────────────────────────
// Must be registered BEFORE express.json()
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  require('./routes/webhook')
);

// ─── Middleware ──────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Rate limit API routes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', limiter);

// ─── Routes ─────────────────────────────────────────────────────────
app.use('/api/stripe', stripeRoutes);

// ─── Health check ────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Catch-all: serve the SPA ────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, () => {
  console.log(`\n🚀 PageForge running at http://localhost:${PORT}`);
  console.log(`   Stripe mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? '🟢 LIVE' : '🟡 TEST'}\n`);
});
