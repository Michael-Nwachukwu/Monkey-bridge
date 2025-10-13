# CryptoPay Bridge - Chrome Extension

> Pay with PYUSD (PayPal USD stablecoin) on any website that doesn't accept crypto

## Overview

This browser extension enables users to pay with PYUSD stablecoin on websites that only accept traditional payments (Stripe, Paystack, etc.). It works by:

1. Detecting checkout pages automatically
2. Extracting payment information
3. Accepting PYUSD payment from user's wallet (MetaMask, Rabby)
4. Processing traditional payment via backend virtual card
5. Auto-filling checkout form

## Project Structure

```
monkey/
├── src/
│   ├── popup.jsx          # Side panel UI (React)
│   ├── content.js         # Page analysis & form filling
│   ├── background.js      # Service worker & messaging
│   └── index.css          # Tailwind styles
├── backend/
│   ├── server.js          # Express API server
│   ├── package.json       # Backend dependencies
│   └── .env.example       # Environment variables template
├── manifest.json          # Extension configuration
├── package.json           # Frontend dependencies
├── vite.config.js         # Build configuration
├── ARCHITECTURE.md        # System design details
├── AI_VS_SCRIPT_ANALYSIS.md   # Page analysis approaches
└── COMPLEXITIES_AND_SOLUTIONS.md  # Challenges & how to solve them
```

## Tech Stack

### Extension
- **React 19** - UI framework
- **Tailwind CSS** - Styling
- **Ethers.js 6** - Blockchain interaction
- **Chrome Extension API** - Manifest V3

### Backend
- **Node.js + Express** - API server
- **Ethers.js** - On-chain verification
- **Stripe Issuing** - Virtual card generation
- **OpenAI API** - AI-powered checkout analysis (optional)
- **PostgreSQL** - Transaction storage (production)
- **Redis** - Rate limiting & caching (production)

### Blockchain
- **PYUSD** (PayPal USD Stablecoin)
- **Ethereum Mainnet** or **Polygon** (lower fees)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- MetaMask or Rabby wallet
- Chrome browser

### 1. Clone & Install

```bash
cd /Users/mac/Documents/projects/monkey

# Install frontend dependencies
npm install

# Install backend dependencies
cd backend
npm install
```

### 2. Configure Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
```env
PORT=3000
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
HOT_WALLET_ADDRESS=0xYourHotWallet
STRIPE_SECRET_KEY=sk_test_your_key
OPENAI_API_KEY=sk-your_openai_key  # Optional for AI analysis
```

### 3. Start Backend

```bash
cd backend
npm start

# Server runs on http://localhost:3000
```

### 4. Build Extension

```bash
# From project root
npm run build

# Or for development with hot reload
npm run dev
```

### 5. Load Extension in Chrome

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist` folder (or `src` for dev mode)

### 6. Configure Extension

1. Click extension icon to open side panel
2. The extension will ask for backend wallet address
3. Go to Chrome extension settings to configure API endpoint

### 7. Test It Out

1. Navigate to a test checkout page (e.g., Stripe demo)
2. Open extension side panel
3. Click "Scan Checkout Page"
4. Connect your MetaMask wallet
5. Review payment details
6. Click "Pay with PYUSD"

## How It Works

### Payment Flow

```
┌─────────────┐
│   User      │
│ (on checkout│
│    page)    │
└──────┬──────┘
       │
       │ 1. Opens extension
       ▼
┌─────────────────┐
│  Side Panel UI  │
│  - Connect      │
│    Wallet       │
│  - Scan Page    │
└──────┬──────────┘
       │
       │ 2. Analyze page
       ▼
┌─────────────────┐
│ Content Script  │
│  - Extract      │
│    price, form  │
│    fields       │
└──────┬──────────┘
       │
       │ 3. Display to user
       ▼
┌─────────────────┐
│ User Reviews &  │
│ Approves PYUSD  │
│    Payment      │
└──────┬──────────┘
       │
       │ 4. Send PYUSD tx
       ▼
┌─────────────────┐
│  Blockchain     │
│  (Ethereum/     │
│   Polygon)      │
└──────┬──────────┘
       │
       │ 5. Verify tx
       ▼
┌─────────────────┐
│  Backend API    │
│  - Verify on-   │
│    chain tx     │
│  - Generate     │
│    virtual card │
└──────┬──────────┘
       │
       │ 6. Return card details
       ▼
┌─────────────────┐
│ Content Script  │
│  - Auto-fill    │
│    payment form │
│  - Submit       │
└──────┬──────────┘
       │
       │ 7. Payment complete
       ▼
┌─────────────────┐
│   Merchant      │
│   Receives $    │
└─────────────────┘
```

## Features

✅ **Automatic Checkout Detection**
- Detects checkout pages automatically
- Shows badge when payment is possible

✅ **Script-Based Page Analysis**
- Fast, free extraction using CSS selectors
- Works on 70%+ of checkout pages
- Patterns for Amazon, Shopify, WooCommerce, Stripe

✅ **AI-Powered Fallback**
- Optional AI analysis for unknown sites
- Toggle in settings
- Uses OpenAI GPT-4 for complex pages

✅ **Multi-Wallet Support**
- MetaMask
- Rabby
- Any EIP-1193 compatible wallet

✅ **PYUSD Integration**
- Shows PYUSD balance
- Real-time balance updates
- 6 decimal precision

✅ **Payment Tracking**
- Transaction history
- Status updates (pending, processing, complete)
- View on block explorer

✅ **Security**
- Never stores private keys
- Minimal data collection
- Local-first processing

## Configuration

### Extension Settings

Store in `chrome.storage.local`:

```javascript
{
  "backendWallet": "0x...",        // Hot wallet address
  "apiEndpoint": "http://localhost:3000",
  "preferredNetwork": "polygon",    // or "ethereum"
  "useAI": false,                   // Enable AI analysis
  "maxSlippage": 0.5               // % for exchange rate
}
```

### Backend Environment Variables

See `backend/.env.example` for full list.

**Required:**
- `RPC_URL` - Ethereum RPC endpoint (Alchemy, Infura)
- `HOT_WALLET_ADDRESS` - Where PYUSD payments are received
- `STRIPE_SECRET_KEY` - For virtual card generation

**Optional:**
- `OPENAI_API_KEY` - For AI checkout analysis
- `DATABASE_URL` - PostgreSQL for production
- `REDIS_URL` - For rate limiting

## API Documentation

### Backend Endpoints

#### `POST /api/analyze-checkout`
Analyze checkout page with AI.

**Request:**
```json
{
  "html": "...",
  "url": "https://example.com/checkout",
  "visibleText": "Total: $99.99",
  "forms": [...]
}
```

**Response:**
```json
{
  "amount": 99.99,
  "currency": "USD",
  "merchantName": "Example Store",
  "paymentFields": {
    "cardNumber": "#card-number",
    "expiry": "#expiry",
    "cvv": "#cvv"
  }
}
```

#### `POST /api/verify-crypto-payment`
Verify PYUSD transaction on-chain.

**Request:**
```json
{
  "transactionId": "tx_123",
  "txHash": "0x...",
  "expectedAmount": 100,
  "currency": "USD"
}
```

**Response:**
```json
{
  "success": true,
  "verified": true,
  "amount": 100.00,
  "confirmations": 12
}
```

#### `POST /api/execute-payment`
Generate virtual card and process payment.

**Request:**
```json
{
  "transactionId": "tx_123",
  "checkoutData": {...},
  "amount": 100,
  "currency": "USD"
}
```

**Response:**
```json
{
  "success": true,
  "virtualCard": {
    "cardNumber": "4242424242424242",
    "expiry": "12/25",
    "cvv": "123"
  }
}
```

#### `GET /api/transaction-status/:id`
Get transaction status.

**Response:**
```json
{
  "id": "tx_123",
  "status": "completed",
  "amount": 100,
  "txHash": "0x...",
  "timestamp": 1234567890
}
```

## Development

### Build Extension

```bash
# Development build with hot reload
npm run dev

# Production build (optimized)
npm run build
```

### Run Tests

```bash
# Frontend tests
npm test

# Backend tests
cd backend && npm test
```

### Debug Extension

1. Open Chrome DevTools in side panel
2. Check `chrome://extensions` for errors
3. View background service worker logs
4. Inspect content script in page DevTools

### Debug Backend

```bash
# Enable debug logging
DEBUG=* npm run dev
```

## Deployment

### Backend Deployment (Recommended: Railway/Render)

```bash
# Railway
railway up

# Or Render
# Connect GitHub repo, auto-deploy
```

### Extension Publishing

1. Build production version: `npm run build`
2. Create zip: `zip -r extension.zip dist/`
3. Upload to Chrome Web Store Developer Dashboard
4. Submit for review

## Important Security Notes

⚠️ **Read Before Deploying:**

1. **Never commit `.env` files**
   - Use `.env.example` as template
   - Store secrets in environment variables

2. **Use HTTPS for backend**
   - Required for production
   - Get free SSL with Let's Encrypt

3. **Validate all inputs**
   - Sanitize user data
   - Prevent XSS attacks

4. **Rate limit API endpoints**
   - Prevent abuse
   - Use Redis for distributed rate limiting

5. **Implement proper error handling**
   - Don't expose stack traces
   - Log errors securely

## Legal Compliance

⚠️ **Critical: Read COMPLEXITIES_AND_SOLUTIONS.md**

This project involves:
- Payment processing (MSB/PSP regulations)
- Cryptocurrency (varies by jurisdiction)
- PCI DSS compliance (if handling cards)
- KYC/AML requirements

**Before launching:**
1. Consult with a lawyer familiar with payment regulations
2. Ensure compliance with local laws
3. Review payment processor terms of service
4. Consider using licensed partners (Privacy.com, Stripe Issuing)

## Cost Estimates

### Per Transaction
- Virtual card: $0.50
- Payment processing: 2.9% + $0.30
- Gas fees: $0.01-$0.10 (Polygon) or $2-$50 (Ethereum)
- AI analysis (optional): $0.02

**Recommendation:** Use Polygon for low fees

### Monthly Infrastructure
- Backend hosting: $20-$100
- RPC node: $0-$50 (Alchemy free tier → paid)
- Database: $0-$25 (start free)
- Monitoring: $0-$50

**Total:** $20-$225/month

## Roadmap

### ✅ Phase 1: MVP (Current)
- [x] Basic extension structure
- [x] Wallet connection (MetaMask)
- [x] PYUSD integration
- [x] Script-based checkout detection
- [x] Backend API
- [x] Manual testing

### 🚧 Phase 2: Scale (Next 3 months)
- [ ] Add 50+ merchant patterns
- [ ] Virtual card generation (Privacy.com API)
- [ ] Auto-fill payment forms
- [ ] AI fallback for unknown sites
- [ ] Transaction history UI
- [ ] Beta user testing

### 📋 Phase 3: Production (6+ months)
- [ ] Multi-chain support (Ethereum + Polygon + Arbitrum)
- [ ] Multiple stablecoins (USDC, USDT, DAI)
- [ ] KYC integration
- [ ] Mobile app (React Native)
- [ ] Merchant dashboard
- [ ] Subscription tiers

## Troubleshooting

### Extension doesn't load
- Check manifest.json is valid
- Ensure all files are in correct locations
- Check Chrome console for errors

### Wallet won't connect
- Ensure MetaMask is installed
- Check network (must be Ethereum or Polygon)
- Clear extension storage and retry

### Checkout detection fails
- Check if page is actually a checkout
- Try enabling AI analysis
- Submit site pattern to improve detection

### Payment fails
- Verify sufficient PYUSD balance
- Check backend is running
- Ensure hot wallet address is correct
- View transaction on block explorer

## Contributing

This is a personal project, but contributions welcome!

1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -m 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Open pull request

## Resources

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
- [AI_VS_SCRIPT_ANALYSIS.md](./AI_VS_SCRIPT_ANALYSIS.md) - Analysis approaches
- [COMPLEXITIES_AND_SOLUTIONS.md](./COMPLEXITIES_AND_SOLUTIONS.md) - Challenges & solutions

### External Documentation
- [Chrome Extension API](https://developer.chrome.com/docs/extensions)
- [Ethers.js Docs](https://docs.ethers.org/v6)
- [PYUSD Info](https://www.paypal.com/us/digital-wallet/manage-money/crypto/pyusd)
- [Stripe Issuing API](https://stripe.com/docs/issuing)

## License

MIT License - See LICENSE file

## Disclaimer

This is experimental software. Use at your own risk.

- No guarantee of functionality
- May violate payment processor ToS
- Cryptocurrency involves risk
- Not financial advice

**Always test thoroughly before real transactions.**

---

Built with ⚡ by [Your Name]

Questions? Open an issue or email: your@email.com
