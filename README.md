# Monkey Bridge - Crypto Payment Bridge Extension 🐵

> Pay with PYUSD (PayPal USD stablecoin) on any website through a secure escrow-based payment system

## Overview

Monkey Bridge is a Chrome extension that enables users to pay with PYUSD cryptocurrency on websites that only accept traditional payment methods (credit/debit cards). It uses a secure escrow smart contract to hold funds until payment is processed, then generates virtual card details to complete the merchant checkout.

### How It Works

1. **User browses** to a checkout page
2. **Extension detects** payment information (amount, merchant)
3. **User deposits PYUSD** into the escrow smart contract
4. **Backend verifies** the on-chain transaction
5. **Backend generates** a virtual card (mock cards for testing)
6. **Extension displays** card details with copy buttons
7. **User completes** merchant checkout with virtual card
8. **Backend releases** funds from escrow to merchant

### Key Features

✅ **Secure Escrow System** - Funds locked in smart contract until payment verified  
✅ **PYUSD Integration** - Uses PayPal USD stablecoin on Ethereum Sepolia testnet  
✅ **Virtual Card Generation** - Creates disposable cards for merchant payments  
✅ **Auto-fill Detection** - Attempts to auto-fill checkout forms (works on non-iframe forms)  
✅ **Multi-Wallet Support** - MetaMask, Coinbase Wallet, Rabby, any EIP-1193 wallet  
✅ **Platform Fee System** - Configurable percentage fee on transactions  
✅ **Refund Protection** - Users can refund if payment not processed within timeout  

---

## Project Structure

```
monkey/
├── src/                          # Extension frontend
│   ├── popup.jsx                 # Main UI (React + Tailwind)
│   ├── content.js                # Page analysis & form auto-fill
│   ├── background.js             # Service worker & API communication
│   ├── config.js                 # Contract addresses & network config
│   ├── WalletBridge.js           # Multi-wallet connection handler
│   ├── EthersProvider.js         # Ethers.js provider wrapper
│   └── public/
│       ├── ooga-logo.png         # Extension icon
│       └── ooga.svg              # Background image
│
├── backend/                      # Node.js API server
│   ├── server.js                 # Express server with endpoints
│   ├── package.json              # Backend dependencies
│   └── .env                      # Environment variables (Sepolia config)
│
├── contracts/                    # Smart contracts (Hardhat)
│   ├── contracts/
│   │   ├── PaymentEscrow.sol     # Main escrow contract
│   │   └── MockERC20.sol         # Mock PYUSD for local testing
│   ├── scripts/
│   │   └── deploy.js             # Deployment script
│   ├── deployments/              # Deployment records
│   │   └── sepolia-*.json        # Sepolia deployment info
│   ├── hardhat.config.js         # Network configuration
│   └── .env                      # Deployer keys & RPC URLs
│
├── manifest.json                 # Chrome extension manifest
├── package.json                  # Frontend dependencies
├── vite.config.js                # Build configuration (Vite + Tailwind)
└── README.md                     # This file
```

---

## Tech Stack

### Extension (Frontend)
- **React 19** - UI framework with hooks
- **Tailwind CSS** - Utility-first styling with custom brand colors
- **Ethers.js v6** - Blockchain interaction & wallet connection
- **Chrome Extension API** - Manifest V3, Side Panel, Content Scripts
- **Vite** - Fast build tool with hot module replacement

### Backend (API Server)
- **Node.js + Express** - RESTful API server
- **Ethers.js** - On-chain transaction verification
- **Stripe API** - Virtual card generation (mock cards in development)
- **In-Memory Storage** - Transaction tracking (production: PostgreSQL)

### Smart Contracts
- **Solidity 0.8.20** - Smart contract language
- **Hardhat** - Development environment & testing framework
- **OpenZeppelin** - Security-audited contract libraries (AccessControl, ReentrancyGuard)
- **PYUSD Token** - PayPal USD stablecoin (6 decimals)

### Blockchain Networks
- **Ethereum Sepolia Testnet** (Primary) - ChainID: 11155111
- **Localhost (Hardhat Node)** - For local development

---

## Deployed Smart Contract (Sepolia)

### PaymentEscrow Contract

**Contract Address:** \`0x87E2202dD12a985afD0cC8f27511d8f428574f68\`  
**Network:** Ethereum Sepolia Testnet  
**View on Etherscan:** https://sepolia.etherscan.io/address/0x87E2202dD12a985afD0cC8f27511d8f428574f68

**PYUSD Token Address:** \`0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9\`  
**Backend Wallet:** \`0xB47d52d931cC06e4269D5EB87Cb1D8F2A07e9e62\`  
**Deployer:** \`0x7FBbE68068A3Aa7E479A1E51e792F4C2073b018f\`  
**Block Number:** 9456045

### Contract Features

1. **Deposit Payment** - User locks PYUSD in escrow with order details
2. **Release Payment** - Backend releases funds to merchant after verification
3. **Refund Payment** - User can refund after timeout period if not processed
4. **Platform Fee** - Configurable percentage fee (default: 1%)
5. **Timeout Protection** - 1-hour timeout for automatic refund eligibility
6. **Role-Based Access** - Backend role required to release payments
7. **Event Logging** - All actions emit events for tracking

### PYUSD Integration

PYUSD (PayPal USD) is a regulated stablecoin issued by Paxos, backed 1:1 by USD deposits and short-term U.S. Treasuries.

**Why PYUSD?**
- Stable value (1 PYUSD = $1 USD)
- 6 decimal precision
- Available on Ethereum mainnet and testnets
- Backed by PayPal
- ERC-20 compatible

**Token Details:**
- **Symbol:** PYUSD
- **Decimals:** 6
- **Standard:** ERC-20
- **Sepolia Address:** \`0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9\`

---

## Complete Payment Flow

### User → Smart Contract → Backend → Merchant

```
┌──────────────────────────────────────────────────────────────┐
│ 1. USER BROWSES TO CHECKOUT PAGE                             │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. CONTENT SCRIPT (content.js)                                │
│    - Scans page for checkout data                            │
│    - Extracts: amount, currency, merchant name               │
│    - Identifies payment form fields                          │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. POPUP UI (popup.jsx)                                       │
│    - User clicks "Scan Checkout Page"                        │
│    - Displays: merchant, amount, platform fee, total         │
│    - User reviews and clicks "Pay with PYUSD"                │
└───────────────────┬────���─────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. WALLET TRANSACTION                                         │
│    Step 1: Approve PYUSD spending                            │
│    - User approves escrow contract to spend PYUSD            │
│    - Transaction: pyusdContract.approve(escrow, amount)      │
│                                                               │
│    Step 2: Deposit to escrow                                 │
│    - User deposits PYUSD + fee to escrow                     │
│    - Transaction: escrow.depositPayment(amount, orderId)     │
│    - Event emitted: PaymentDeposited(paymentId, ...)         │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. SMART CONTRACT (PaymentEscrow.sol)                        │
│    - Receives PYUSD from user                                │
│    - Stores payment record with metadata                     │
│    - Calculates and stores platform fee                      │
│    - Sets status: Pending                                    │
│    - Locks funds until backend releases or user refunds      │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ 6. BACKGROUND SCRIPT (background.js)                          │
│    - Calls: /api/verify-crypto-payment                       │
│    - Sends: txHash, amount, escrowAddress                    │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ 7. BACKEND API (server.js)                                    │
│    Endpoint: POST /api/verify-crypto-payment                 │
│    - Verifies transaction on-chain via Sepolia RPC           │
│    - Confirms: correct amount, escrow address, PYUSD token   │
│    - Marks transaction as "verified"                         │
│                                                               │
│    Endpoint: POST /api/execute-payment                       │
│    - Generates virtual card (mock for testing)               │
│    - Card details: number, expiry, CVV                       │
│    - Returns card to extension                               │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ 8. POPUP UI (popup.jsx)                                       │
│    - Displays virtual card details                           │
│    - Shows copy buttons for: card number, expiry, CVV        │
│    - Attempts auto-fill (if not in iframe)                   │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ 9. USER COMPLETES CHECKOUT                                    │
│    - Copies card details (or uses auto-filled form)          │
│    - Submits payment on merchant site                        │
│    - Merchant charges virtual card                           │
└───────────────────┬──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ 10. BACKEND RELEASES ESCROW                                   │
│     - Backend calls: escrow.releasePayment(paymentId)        │
│     - Smart contract transfers PYUSD to backend wallet       │
│     - Status updated: Completed                              │
│     - Event emitted: PaymentReleased(paymentId, ...)         │
└──────────────────────────────────────────────────────────────┘
```

---

## Getting Started

### Prerequisites

Before you begin, make sure you have:

- **Node.js 18+** and npm installed
- **Chrome browser** (or Edge/Brave)
- **Crypto wallet** (MetaMask, Coinbase Wallet, or Rabby)
- **Sepolia testnet ETH** (for gas fees)
- **Sepolia PYUSD** (for payments)

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/monkey.git
cd monkey
```

### 2. Install Dependencies

```bash
# Install extension dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Install contract dependencies (optional - only if deploying)
cd ../contracts
npm install
```

### 3. Configure Backend Environment

```bash
cd backend
```

Create or edit \`.env\` file:

```env
# Server Configuration
PORT=3000
NODE_ENV=development
USE_MOCK_CARDS=true

# Ethereum Sepolia Configuration
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
HOT_WALLET_ADDRESS=0xB47d52d931cC06e4269D5EB87Cb1D8F2A07e9e62
HOT_WALLET_PRIVATE_KEY=your_private_key_here

# Smart Contract Addresses (Sepolia)
ESCROW_CONTRACT_ADDRESS=0x87E2202dD12a985afD0cC8f27511d8f428574f68
PYUSD_TOKEN_ADDRESS=0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9

# Stripe Configuration (optional - uses mock cards by default)
STRIPE_SECRET_KEY=sk_test_your_stripe_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_key

# AI Configuration (optional)
GROQ_API_KEY=your_groq_api_key
AI_PROVIDER=groq
```

**Get an Alchemy API Key:**
1. Visit https://www.alchemy.com
2. Sign up and create a new app
3. Select "Ethereum" → "Sepolia"
4. Copy your API key and replace \`YOUR_ALCHEMY_KEY\`

### 4. Start the Backend Server

```bash
cd backend
npm start
```

You should see:
```
CryptoPay Backend running on port 3000
Hot wallet: 0xB47d52d931cC06e4269D5EB87Cb1D8F2A07e9e62
```

**Keep this terminal running.**

### 5. Build the Extension

Open a new terminal:

```bash
cd /path/to/monkey
npm run build
```

This creates a production build in the \`dist/\` folder.

### 6. Load Extension in Chrome

1. Open Chrome and go to \`chrome://extensions\`
2. Enable **"Developer mode"** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the \`dist\` folder from the project
5. You should see "Monkey Bridge" with the monkey logo 🐵

### 7. Get Sepolia Testnet Assets

#### Get Sepolia ETH (for gas fees)

Visit any of these faucets:
- https://sepoliafaucet.com
- https://www.alchemy.com/faucets/ethereum-sepolia
- https://faucet.quicknode.com/ethereum/sepolia

Enter your wallet address and request ETH.

#### Get Sepolia PYUSD

PYUSD Contract: \`0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9\`

You may need to:
- Find a Sepolia PYUSD faucet
- Ask in community Discord/Telegram for test PYUSD
- Check if the contract has a public mint function

### 8. Configure Your Wallet

1. Open MetaMask (or your wallet)
2. Add Sepolia network (if not already added)
3. Switch to **Sepolia Test Network**
4. Verify you have:
   - Some Sepolia ETH (0.01+ recommended)
   - Some Sepolia PYUSD (for testing payments)

### 9. Test the Extension

1. **Open the extension:**
   - Click the Monkey Bridge icon in Chrome toolbar

2. **Connect your wallet:**
   - Click "Connect Wallet"
   - Approve the connection in MetaMask
   - You should see your ETH and PYUSD balances

3. **Navigate to a test checkout page:**
   - Example: https://checkout.stripe.dev/preview
   - Or any e-commerce test site

4. **Make a payment:**
   - Click "Scan Checkout Page" in the extension
   - Review the detected amount and merchant
   - Click "Pay [amount] PYUSD (Escrow)"
   - Approve the PYUSD spending in your wallet
   - Confirm the deposit transaction
   - Wait for "Payment Complete!" message
   - Copy virtual card details shown in the extension
   - Complete the merchant checkout with those card details

---

## Development Commands

```bash
# Extension
npm run build        # Production build
npm run dev          # Development mode with hot reload

# Backend
cd backend
npm start            # Start server

# Contracts (optional)
cd contracts
npx hardhat compile  # Compile contracts
npx hardhat test     # Run tests
npx hardhat node     # Start local blockchain
npx hardhat run scripts/deploy.js --network sepolia  # Deploy to Sepolia
```

---

## Troubleshooting

### Extension won't load
- Check \`chrome://extensions\` for errors
- Verify all files are in \`dist/\` folder
- Try removing and re-adding the extension
- Check manifest.json is valid JSON

### Wallet won't connect
- Ensure MetaMask/wallet is installed
- Check you're on Sepolia network (not mainnet!)
- Try refreshing the page
- Check browser console for errors

### "Unsupported network" error
- Switch wallet to Sepolia testnet
- Verify chain ID is 11155111
- Extension only supports networks in config.js

### Balance shows 0 or doesn't load
- Verify you have Sepolia PYUSD in your wallet
- Add PYUSD token to MetaMask:
  - Token address: \`0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9\`
  - Symbol: PYUSD
  - Decimals: 6
- Check backend RPC_URL is correct
- Ensure backend server is running

### Payment transaction fails
- Check you have enough Sepolia ETH for gas
- Verify PYUSD balance (amount + 1% fee)
- Check backend server is running
- Look for errors in browser console
- Check backend logs for errors

### Virtual card details don't show
- Verify backend server is running (\`localhost:3000\`)
- Check \`USE_MOCK_CARDS=true\` in backend .env
- Look at backend logs for errors
- Try disconnecting and reconnecting wallet

### Auto-fill doesn't work
- Auto-fill only works on regular HTML forms
- Most payment processors use iframes (Stripe Elements, etc.)
- This is a browser security limitation
- Use the copy buttons instead

---

## Project Architecture

### Smart Contract Layer
\`PaymentEscrow.sol\` - Holds user funds in escrow until backend releases them

**Key Functions:**
- \`depositPayment()\` - User locks PYUSD with order details
- \`releasePayment()\` - Backend releases funds to merchant
- \`refundPayment()\` - User gets refund after timeout
- \`platformFeeBps()\` - Returns platform fee (100 = 1%)

### Backend Layer
\`server.js\` - Express API that:
- Verifies on-chain transactions
- Generates virtual cards (mock or real via Stripe)
- Communicates with smart contract
- Tracks transaction state

**API Endpoints:**
- \`POST /api/verify-crypto-payment\` - Verify blockchain transaction
- \`POST /api/execute-payment\` - Generate virtual card
- \`GET /api/transaction-status/:id\` - Get transaction status

### Extension Layer
- \`popup.jsx\` - User interface (wallet, balance, payment flow)
- \`content.js\` - Page scanning and form filling
- \`background.js\` - API communication and state management
- \`config.js\` - Network and contract configuration

---

## Security Considerations

⚠️ **Important Security Notes:**

1. **Never commit private keys** - Use .env files (in .gitignore)
2. **Smart contract audited** - Uses OpenZeppelin libraries
3. **Backend security** - Implement HTTPS, rate limiting in production
4. **Extension permissions** - Minimal permissions requested
5. **Data privacy** - Local-first, no tracking

**Production Checklist:**
- [ ] Professional smart contract audit
- [ ] HTTPS for backend
- [ ] Rate limiting on API endpoints
- [ ] Input validation and sanitization
- [ ] Error logging (Sentry, etc.)
- [ ] Monitor for suspicious activity
- [ ] Legal compliance review

---

## Costs & Economics

### Transaction Costs (Sepolia - FREE)
- Gas fees: FREE (testnet ETH)
- Platform fee: 1% of payment amount

### Production Costs (Ethereum Mainnet)
- Gas fees: $2-50 per transaction
- Platform fee: 1% (configurable)
- Virtual card: $0-0.50 (Stripe Issuing)

### Monthly Infrastructure
- Backend hosting: $20-100
- RPC provider: $0-50 (Alchemy free → paid)
- Database: $0-25
- Monitoring: $0-50

**Total:** ~$20-225/month

**Cost Optimization Tips:**
- Use Polygon or Arbitrum (lower gas fees)
- Batch transactions when possible
- Use RPC provider free tiers
- Start small and scale up

---

## Roadmap

### ✅ Completed (MVP)
- [x] Chrome extension with React UI
- [x] Multi-wallet support
- [x] PYUSD integration with 6 decimal precision
- [x] Secure escrow smart contract
- [x] Deployed to Sepolia testnet
- [x] Backend API with verification
- [x] Virtual card generation (mock)
- [x] Auto-fill attempt + copy buttons
- [x] Platform fee system
- [x] Custom branding

### 🚧 Next Steps
- [ ] Production virtual cards (Stripe Issuing)
- [ ] Enhanced merchant detection
- [ ] Transaction history UI
- [ ] Better error handling

### 📋 Future Enhancements
- [ ] Multi-chain (Polygon, Arbitrum, Base)
- [ ] Multi-stablecoin (USDC, USDT, DAI)
- [ ] WalletConnect for mobile
- [ ] Merchant dashboard
- [ ] Dispute resolution
- [ ] Firefox/Safari support

---

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create feature branch: \`git checkout -b feature-name\`
3. Make changes and test thoroughly
4. Commit: \`git commit -m 'Add feature'\`
5. Push: \`git push origin feature-name\`
6. Open a Pull Request

---

## Resources

### Documentation
- [Chrome Extensions](https://developer.chrome.com/docs/extensions)
- [Ethers.js v6](https://docs.ethers.org/v6)
- [Hardhat](https://hardhat.org/docs)
- [PYUSD Info](https://www.paypal.com/us/digital-wallet/manage-money/crypto/pyusd)
- [OpenZeppelin](https://docs.openzeppelin.com/contracts)

### Tools
- [Sepolia Faucet](https://sepoliafaucet.com)
- [Sepolia Etherscan](https://sepolia.etherscan.io)
- [Alchemy](https://dashboard.alchemy.com)

---

## License

MIT License - See LICENSE file

---

## Disclaimer

⚠️ **Experimental Software - Use at Your Own Risk**

- No warranty or guarantee
- May violate payment processor ToS
- Cryptocurrency involves financial risk
- Not financial advice
- Test thoroughly before production
- Consult legal counsel

---

**Built with ⚡ by the Monkey Bridge Team**

*Bridging crypto and traditional payments* 🐵🌉
