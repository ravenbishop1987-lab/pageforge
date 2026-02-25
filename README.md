# ⚡ PageForge — AI SEO Page Generator SaaS

Full-stack micro-SaaS with Stripe billing ($12/mo or $49 lifetime).

---

## Stack

- **Frontend** — Vanilla HTML/CSS/JS (in `/public/index.html`)
- **Backend** — Node.js + Express
- **Payments** — Stripe Checkout + Webhooks
- **AI** — Anthropic Claude API (client-side, user's own key)

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Stripe

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Create two products:
   - **Pro Monthly** → Recurring price → $12.00/month
   - **Lifetime Access** → One-time price → $49.00
3. Copy the **Price IDs** (start with `price_...`)

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
STRIPE_SECRET_KEY=sk_test_...        # From Stripe Dashboard → API keys
STRIPE_WEBHOOK_SECRET=whsec_...      # Set up in step 4
STRIPE_PRICE_MONTHLY=price_...       # Your $12/mo price ID
STRIPE_PRICE_LIFETIME=price_...      # Your $49 one-time price ID
APP_URL=http://localhost:3000         # Change to your domain in production
```

### 4. Set up Stripe Webhook

**For local development:**
```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:3000/webhook
# Copy the webhook signing secret it gives you → STRIPE_WEBHOOK_SECRET in .env
```

**For production:**
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://yourdomain.com/webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
4. Copy the signing secret → `STRIPE_WEBHOOK_SECRET`

### 5. Run

```bash
# Development
npm run dev

# Production
npm start
```

Open [http://localhost:3000](http://localhost:3000)

---

## How It Works

### Payment Flow

```
User clicks "Get started" 
  → POST /api/stripe/checkout { plan: 'monthly' | 'lifetime' }
  → Redirected to Stripe Checkout
  → Completes payment
  → Redirected to /?session_id=...
  → POST /api/stripe/verify { sessionId }
  → Access granted, accessToken issued
  → User enters app
```

### Webhook Flow

```
Stripe fires events → POST /webhook
  → subscription cancelled → access revoked
  → invoice paid → access renewed
  → payment failed → logged (add dunning email here)
```

### Restore Access

Users can re-authenticate by email on the pricing page ("Already have access? Sign in →").

---

## File Structure

```
pageforge/
├── server.js              # Express app entry point
├── routes/
│   ├── stripe.js          # Checkout, verify, portal endpoints + license store
│   └── webhook.js         # Stripe webhook event handler
├── public/
│   └── index.html         # Frontend SPA (pricing + app)
├── .env.example           # Environment variable template
└── package.json
```

---

## Production Checklist

- [ ] Use a real database (PostgreSQL, MongoDB) instead of the in-memory `licenses` Map
- [ ] Add JWT or signed tokens instead of base64 access tokens
- [ ] Set `APP_URL` to your production domain
- [ ] Switch Stripe to live mode (`sk_live_...`)
- [ ] Add HTTPS (required by Stripe)
- [ ] Set up transactional email for payment receipts / dunning
- [ ] Consider rate limiting per user, not just per IP

---

## Pricing

| Plan | Price | Mode |
|------|-------|------|
| Pro Monthly | $12/month | Stripe Subscription |
| Lifetime | $49 one-time | Stripe Payment |

Both plans get identical features. Lifetime = saves $144/year vs monthly.

---

## License

MIT
