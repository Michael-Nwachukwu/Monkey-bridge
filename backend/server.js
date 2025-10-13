// Backend Server - Node.js + Express
// Handles crypto payment verification and traditional payment processing

const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const Stripe = require('stripe');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Auto-generate missing secrets
function ensureSecrets() {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) {
    console.log('⚠️  .env file not found. Creating from .env.example...');
    const examplePath = path.join(__dirname, '.env.example');
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, envPath);
    }
  }

  let envContent = fs.readFileSync(envPath, 'utf8');
  let updated = false;

  // Auto-generate JWT_SECRET if missing
  if (!process.env.JWT_SECRET) {
    const jwtSecret = crypto.randomBytes(64).toString('hex');
    process.env.JWT_SECRET = jwtSecret;
    envContent = envContent.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${jwtSecret}`);
    updated = true;
    console.log('✅ Generated JWT_SECRET');
  }

  // Auto-generate API_KEY_SALT if missing
  if (!process.env.API_KEY_SALT) {
    const apiKeySalt = crypto.randomBytes(32).toString('hex');
    process.env.API_KEY_SALT = apiKeySalt;
    envContent = envContent.replace(/^API_KEY_SALT=.*$/m, `API_KEY_SALT=${apiKeySalt}`);
    updated = true;
    console.log('✅ Generated API_KEY_SALT');
  }

  if (updated) {
    fs.writeFileSync(envPath, envContent);
    console.log('💾 Updated .env with generated secrets\n');
  }
}

// Run on startup
ensureSecrets();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize services
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL); // Ethereum RPC
const PYUSD_ADDRESS = '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8';
const HOT_WALLET_ADDRESS = process.env.HOT_WALLET_ADDRESS;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-memory transaction store (use Redis/PostgreSQL in production)
const transactions = new Map();

// ============= ROUTES =============

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Analyze checkout page with AI
app.post('/api/analyze-checkout', async (req, res) => {
  try {
    const { html, url, visibleText, forms } = req.body;

    // Call OpenAI/Claude to analyze the page
    const analysis = await analyzeCheckoutWithAI({
      html,
      url,
      visibleText,
      forms
    });

    res.json(analysis);
  } catch (error) {
    console.error('AI analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify crypto payment on-chain
app.post('/api/verify-crypto-payment', async (req, res) => {
  try {
    const { transactionId, txHash, expectedAmount, currency } = req.body;

    console.log(`Verifying transaction ${txHash}`);

    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return res.status(400).json({ error: 'Transaction not found' });
    }

    if (receipt.status !== 1) {
      return res.status(400).json({ error: 'Transaction failed on-chain' });
    }

    // Parse PYUSD transfer event
    const pyusdInterface = new ethers.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ]);

    let transferFound = false;
    let transferAmount = 0;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === PYUSD_ADDRESS.toLowerCase()) {
        try {
          const parsed = pyusdInterface.parseLog(log);
          if (parsed.name === 'Transfer' &&
              parsed.args.to.toLowerCase() === HOT_WALLET_ADDRESS.toLowerCase()) {
            transferFound = true;
            transferAmount = ethers.formatUnits(parsed.args.value, 6); // PYUSD has 6 decimals
          }
        } catch (e) {
          // Not a Transfer event
        }
      }
    }

    if (!transferFound) {
      return res.status(400).json({
        error: 'PYUSD transfer to hot wallet not found in transaction'
      });
    }

    // Verify amount (with small tolerance for rounding)
    const amountDiff = Math.abs(parseFloat(transferAmount) - parseFloat(expectedAmount));
    if (amountDiff > 0.01) {
      return res.status(400).json({
        error: `Amount mismatch. Expected ${expectedAmount}, got ${transferAmount}`
      });
    }

    // Store verification
    transactions.set(transactionId, {
      id: transactionId,
      status: 'verified',
      txHash,
      amount: transferAmount,
      currency,
      verifiedAt: Date.now()
    });

    res.json({
      success: true,
      verified: true,
      amount: transferAmount,
      txHash,
      confirmations: receipt.blockNumber
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute payment using virtual card
app.post('/api/execute-payment', async (req, res) => {
  try {
    const { transactionId, checkoutData, amount, currency } = req.body;

    // Verify transaction was verified first
    const tx = transactions.get(transactionId);
    if (!tx || tx.status !== 'verified') {
      return res.status(400).json({
        error: 'Transaction not verified'
      });
    }

    console.log(`Executing payment for transaction ${transactionId}`);

    // Generate virtual card via Stripe Issuing or similar service
    const virtualCard = await generateVirtualCard(amount, currency);

    // Update transaction
    transactions.set(transactionId, {
      ...tx,
      status: 'processing',
      virtualCard: {
        number: virtualCard.number,
        expiry: virtualCard.expiry,
        cvv: virtualCard.cvv
      }
    });

    res.json({
      success: true,
      virtualCard: {
        cardNumber: virtualCard.number,
        expiry: virtualCard.expiry,
        cvv: virtualCard.cvv
      },
      transactionId
    });

  } catch (error) {
    console.error('Payment execution error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction status
app.get('/api/transaction-status/:id', (req, res) => {
  const tx = transactions.get(req.params.id);

  if (!tx) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  res.json(tx);
});

// Webhook to handle payment completion (from Stripe/Paystack)
// NOTE: Webhooks are OPTIONAL for MVP testing
app.post('/api/webhook/payment-complete', async (req, res) => {
  try {
    let event;

    // If webhook secret is configured, verify signature
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } else {
      // For testing without webhook secret, just use the body
      console.warn('⚠️  Webhook secret not configured - skipping signature verification');
      event = req.body;
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      console.log(`Payment succeeded: ${paymentIntent.id}`);

      // Mark transaction as complete
      // Find transaction by payment intent metadata
      for (const [txId, tx] of transactions.entries()) {
        if (tx.paymentIntentId === paymentIntent.id) {
          transactions.set(txId, {
            ...tx,
            status: 'completed',
            completedAt: Date.now()
          });
          break;
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============= HELPER FUNCTIONS =============

// Analyze checkout page using AI (OpenAI or Groq)
async function analyzeCheckoutWithAI(pageContext) {
  const prompt = `
You are analyzing a checkout page. Extract the following information:
1. Total amount to be paid
2. Currency (USD, EUR, GBP, etc.)
3. Merchant name
4. CSS selectors or XPaths for payment form fields (card number, expiry, CVV)

Page URL: ${pageContext.url}
Page visible text:
${pageContext.visibleText}

Forms found:
${JSON.stringify(pageContext.forms, null, 2)}

Return a JSON object with this structure:
{
  "amount": number,
  "currency": "USD",
  "merchantName": "string",
  "paymentFields": {
    "cardNumber": "css selector or xpath",
    "expiry": "css selector or xpath",
    "cvv": "css selector or xpath"
  }
}
`;

  // Choose AI provider
  const provider = process.env.AI_PROVIDER || (process.env.GROQ_API_KEY ? 'groq' : 'openai');

  let response;

  if (provider === 'groq' && process.env.GROQ_API_KEY) {
    // Use Groq (FREE and faster!)
    console.log('Using Groq AI for analysis');
    response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-70b-versatile', // Fast and accurate model
        messages: [
          {
            role: 'system',
            content: 'You are a checkout page analyzer. Return only valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } else if (process.env.OPENAI_API_KEY) {
    // Use OpenAI
    console.log('Using OpenAI for analysis');
    response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini', // Cheaper and faster than gpt-4
        messages: [
          {
            role: 'system',
            content: 'You are a checkout page analyzer. Return only valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } else {
    throw new Error('No AI API key configured. Set GROQ_API_KEY or OPENAI_API_KEY in .env');
  }

  const result = response.data.choices[0].message.content;

  // Parse JSON from response
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error('Could not parse AI response');
}

// Generate virtual card using Stripe Issuing
async function generateVirtualCard(amount, currency) {
  try {
    // Create a cardholder (you'd typically have this set up already)
    const cardholderResult = await getOrCreateCardholder();

    // Create a card
    const card = await stripe.issuing.cards.create({
      cardholder: cardholderResult.id,
      type: 'virtual',
      currency: currency.toLowerCase(),
      spending_controls: {
        spending_limits: [
          {
            amount: Math.ceil(amount * 100), // Convert to cents
            interval: 'per_authorization'
          }
        ]
      },
      metadata: {
        purpose: 'cryptopay-bridge',
        amount: amount.toString()
      }
    });

    // Get card details (requires elevated API key)
    const cardDetails = await stripe.issuing.cards.retrieve(card.id);

    return {
      number: cardDetails.number,
      expiry: `${cardDetails.exp_month}/${cardDetails.exp_year}`,
      cvv: cardDetails.cvc,
      cardId: card.id
    };

  } catch (error) {
    console.error('Virtual card generation error:', error);

    // Fallback: Return test card for development
    if (process.env.NODE_ENV === 'development') {
      return {
        number: '4242424242424242',
        expiry: '12/25',
        cvv: '123'
      };
    }

    throw error;
  }
}

// Get or create cardholder for issuing cards
async function getOrCreateCardholder() {
  // Check if we have a default cardholder
  const cardholders = await stripe.issuing.cardholders.list({ limit: 1 });

  if (cardholders.data.length > 0) {
    return cardholders.data[0];
  }

  // Create new cardholder
  return await stripe.issuing.cardholders.create({
    name: 'CryptoPay Bridge',
    email: 'bridge@cryptopay.com',
    phone_number: '+1234567890',
    type: 'company',
    billing: {
      address: {
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94111',
        country: 'US'
      }
    }
  });
}

// Exchange rate service (PYUSD to USD should be 1:1, but add flexibility)
async function getExchangeRate(from, to) {
  if (from === 'PYUSD' && to === 'USD') {
    return 1.0; // PYUSD is pegged to USD
  }

  // For other currencies, use a real exchange rate API
  const response = await axios.get(
    `https://api.exchangerate-api.com/v4/latest/${from}`
  );

  return response.data.rates[to];
}

// ============= START SERVER =============

app.listen(PORT, () => {
  console.log(`CryptoPay Backend running on port ${PORT}`);
  console.log(`Hot wallet: ${HOT_WALLET_ADDRESS}`);
});

module.exports = app;
