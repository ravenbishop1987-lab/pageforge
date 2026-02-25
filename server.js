require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const stripeRoutes = require('./routes/stripe');
const generateRoute = require('./routes/generate');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Stripe webhook needs raw body ───────────────────────────────────
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  require('./routes/webhook')
);

// ─── Middleware ──────────────────────────────────────────────────────
app.use(cors({ origin: process.env.APP_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.static('public'));

// Rate limit API routes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', limiter);

// ─── Stripe API routes ───────────────────────────────────────────────
app.use('/api/stripe', stripeRoutes);

// ─── Generate API route ──────────────────────────────────────────────
app.use('/api/generate', generateRoute);

// ─── Health check ────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Named routes ────────────────────────────────────────────────────
app.get('/app', (req, res) => res.sendFile(__dirname + '/public/app.html'));
app.get('/dashboard', (req, res) => res.sendFile(__dirname + '/public/index.html'));

// ─── Catch-all: pricing/dashboard SPA ───────────────────────────────
app.get('*', (req, res) => res.sendFile(__dirname + '/public/index.html'));

app.listen(PORT, () => {
  console.log(`\n🚀 PageForge running at http://localhost:${PORT}`);
  console.log(`   Stripe mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? '🟢 LIVE' : '🟡 TEST'}\n`);
  console.log(`   Claude AI: ${process.env.ANTHROPIC_API_KEY ? '🟢 configured' : '🔴 ANTHROPIC_API_KEY not set'}\n`);
});
