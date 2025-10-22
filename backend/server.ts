// Backend Server - Node.js + Express (TypeScript)
// Handles crypto payment verification and traditional payment processing

import express, { Request, Response, NextFunction, Application } from 'express';
import cors from 'cors';
import { ethers, TransactionReceipt, Log, Interface } from 'ethers';
import Stripe from 'stripe';
import axios, { AxiosResponse } from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// ============= TYPE DEFINITIONS =============

type TransactionStatus = 'pending' | 'verified' | 'processing' | 'completed' | 'failed';

interface VirtualCard {
  number: string;
  expiry: string;
  cvv: string;
  cardId?: string;
  isMock?: boolean;
}

interface Transaction {
  id: string;
  status: TransactionStatus;
  txHash?: string;
  amount: number | string;
  currency: string;
  verifiedAt?: number;
  completedAt?: number;
  virtualCard?: {
    number: string;
    expiry: string;
    cvv: string;
  };
  paymentIntentId?: string;
}

interface PaymentData {
  transactionId: string;
  checkoutData: CheckoutData;
  amount: number;
  currency: string;
}

interface CheckoutData {
  url?: string;
  merchantName?: string;
  paymentFields?: {
    cardNumber?: string;
    expiry?: string;
    cvv?: string;
  };
}

interface CryptoPaymentVerificationRequest {
  transactionId: string;
  txHash: string;
  expectedAmount: number;
  currency: string;
  escrowAddress?: string;
}

interface AnalysisResult {
  amount: number;
  currency: string;
  merchantName: string;
  paymentFields: {
    cardNumber: string;
    expiry: string;
    cvv: string;
  };
}

interface PageContext {
  html?: string;
  url: string;
  visibleText: string;
  forms: any[];
}

interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AICompletionRequest {
  model: string;
  messages: AIMessage[];
  temperature: number;
  max_tokens: number;
}

interface AICompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface ExchangeRateResponse {
  rates: {
    [currency: string]: number;
  };
}

// ============= INITIALIZATION =============

// Auto-generate missing secrets
function ensureSecrets(): void {
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

const app: Application = express();
const PORT: number = parseInt(process.env.PORT || '3000', 10);

// Initialize services
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16'
});
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL); // Ethereum RPC
const PYUSD_ADDRESS: string = '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8';
const HOT_WALLET_ADDRESS: string | undefined = process.env.HOT_WALLET_ADDRESS;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-memory transaction store (use Redis/PostgreSQL in production)
const transactions: Map<string, Transaction> = new Map();

// ============= ROUTES =============

// Health check
app.get('/health', (req: Request, res: Response): void => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Analyze checkout page with AI
app.post('/api/analyze-checkout', async (req: Request, res: Response): Promise<void> => {
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

// Verify crypto payment on-chain
app.post('/api/verify-crypto-payment', async (req: Request, res: Response): Promise<void> => {
  try {
    const { transactionId, txHash, expectedAmount, currency, escrowAddress }: CryptoPaymentVerificationRequest = req.body;

    console.log(`✅ Verifying transaction ${txHash}`);
    console.log(`   Expected amount: ${expectedAmount} ${currency}`);
    console.log(`   Escrow address: ${escrowAddress || process.env.ESCROW_CONTRACT_ADDRESS}`);

    // For MVP: Skip on-chain verification if using mock mode
    if (process.env.USE_MOCK_CARDS === 'true' || process.env.NODE_ENV === 'development') {
      console.log('⚠️  Development mode - skipping on-chain verification');

      // Store verification
      transactions.set(transactionId, {
        id: transactionId,
        status: 'verified',
        txHash,
        amount: expectedAmount,
        currency,
        verifiedAt: Date.now()
      });

      res.json({
        success: true,
        verified: true,
        amount: expectedAmount,
        txHash,
        confirmations: 1,
        note: 'Mock verification for development'
      });
      return;
    }

    // Production: Verify on-chain
    const receipt: TransactionReceipt | null = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      res.status(400).json({ error: 'Transaction not found' });
      return;
    }

    if (receipt.status !== 1) {
      res.status(400).json({ error: 'Transaction failed on-chain' });
      return;
    }

    // Parse PaymentDeposited event from escrow contract
    const escrowInterface: Interface = new ethers.Interface([
      'event PaymentDeposited(uint256 indexed paymentId, address indexed payer, uint256 amount, string orderId)'
    ]);

    let depositFound = false;
    let depositAmount: string = '0';

    const targetEscrow: string = escrowAddress || process.env.ESCROW_CONTRACT_ADDRESS || '';

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === targetEscrow.toLowerCase()) {
        try {
          const parsed = escrowInterface.parseLog({
            topics: [...log.topics],
            data: log.data
          });
          if (parsed && parsed.name === 'PaymentDeposited') {
            depositFound = true;
            depositAmount = ethers.formatUnits(parsed.args.amount, 6); // PYUSD has 6 decimals
            console.log(`✅ Found PaymentDeposited event: ${depositAmount} PYUSD`);
          }
        } catch (e) {
          // Not the event we're looking for
        }
      }
    }

    if (!depositFound) {
      res.status(400).json({
        error: 'PaymentDeposited event not found in transaction'
      });
      return;
    }

    // Verify amount (with small tolerance for rounding)
    const amountDiff = Math.abs(parseFloat(depositAmount) - parseFloat(expectedAmount.toString()));
    if (amountDiff > 0.01) {
      res.status(400).json({
        error: `Amount mismatch. Expected ${expectedAmount}, got ${depositAmount}`
      });
      return;
    }

    // Store verification
    transactions.set(transactionId, {
      id: transactionId,
      status: 'verified',
      txHash,
      amount: depositAmount,
      currency,
      verifiedAt: Date.now()
    });

    res.json({
      success: true,
      verified: true,
      amount: depositAmount,
      txHash,
      confirmations: receipt.blockNumber
    });

  } catch (error) {
    console.error('❌ Verification error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

// Execute payment using virtual card
app.post('/api/execute-payment', async (req: Request, res: Response): Promise<void> => {
  try {
    const { transactionId, checkoutData, amount, currency }: PaymentData = req.body;

    // Verify transaction was verified first
    const tx = transactions.get(transactionId);
    if (!tx || tx.status !== 'verified') {
      res.status(400).json({
        error: 'Transaction not verified'
      });
      return;
    }

    console.log(`Executing payment for transaction ${transactionId}`);

    // Generate virtual card via Stripe Issuing or similar service
    const virtualCard: VirtualCard = await generateVirtualCard(amount, currency);

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

// Get transaction status
app.get('/api/transaction-status/:id', (req: Request, res: Response): void => {
  const tx = transactions.get(req.params.id);

  if (!tx) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  res.json(tx);
});

// Webhook to handle payment completion (from Stripe/Paystack)
// NOTE: Webhooks are OPTIONAL for MVP testing
app.post('/api/webhook/payment-complete', async (req: Request, res: Response): Promise<void> => {
  try {
    let event: Stripe.Event;

    // If webhook secret is configured, verify signature
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers['stripe-signature'];

      if (!sig) {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }

      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } else {
      // For testing without webhook secret, just use the body
      console.warn('⚠️  Webhook secret not configured - skipping signature verification');
      event = req.body as Stripe.Event;
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: errorMessage });
  }
});

// ============= HELPER FUNCTIONS =============

// Analyze checkout page using AI (OpenAI or Groq)
async function analyzeCheckoutWithAI(pageContext: PageContext): Promise<AnalysisResult> {
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
  const aiProvider = process.env.AI_PROVIDER || (process.env.GROQ_API_KEY ? 'groq' : 'openai');

  let response: AxiosResponse<AICompletionResponse>;

  if (aiProvider === 'groq' && process.env.GROQ_API_KEY) {
    // Use Groq (FREE and faster!)
    console.log('Using Groq AI for analysis');
    response = await axios.post<AICompletionResponse>(
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
      } as AICompletionRequest,
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
    response = await axios.post<AICompletionResponse>(
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
      } as AICompletionRequest,
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
    return JSON.parse(jsonMatch[0]) as AnalysisResult;
  }

  throw new Error('Could not parse AI response');
}

// Generate virtual card using Stripe Issuing
async function generateVirtualCard(amount: number, currency: string): Promise<VirtualCard> {
  try {
    // Check if we should use mock cards (development mode or USE_MOCK_CARDS flag)
    if (process.env.USE_MOCK_CARDS === 'true' || process.env.NODE_ENV === 'development') {
      console.log('🃏 Using mock virtual card for development');

      // Generate random-looking test card data
      const mockCards: VirtualCard[] = [
        { number: '4242424242424242', expiry: '12/26', cvv: '123' },
        { number: '5555555555554444', expiry: '03/27', cvv: '456' },
        { number: '378282246310005', expiry: '08/25', cvv: '789' }
      ];

      // Return a random mock card
      const randomCard = mockCards[Math.floor(Math.random() * mockCards.length)];

      return {
        ...randomCard,
        cardId: `mock_card_${Date.now()}`
      };
    }

    // Production: Try to create real Stripe Issuing card
    console.log('💳 Creating real Stripe virtual card');

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
      number: cardDetails.number || '',
      expiry: `${cardDetails.exp_month}/${cardDetails.exp_year}`,
      cvv: cardDetails.cvc || '',
      cardId: card.id
    };

  } catch (error) {
    console.error('❌ Virtual card generation error:', error instanceof Error ? error.message : error);

    // If Stripe Issuing is not enabled, fall back to mock cards
    if (error instanceof Error && error.message.includes('not set up to use Issuing')) {
      console.warn('⚠️  Stripe Issuing not enabled. Falling back to mock cards.');
      console.warn('   To enable Stripe Issuing, visit: https://dashboard.stripe.com/issuing/overview');

      return {
        number: '4242424242424242',
        expiry: '12/26',
        cvv: '123',
        cardId: `mock_card_${Date.now()}`,
        isMock: true
      };
    }

    throw error;
  }
}

// Get or create cardholder for issuing cards
async function getOrCreateCardholder(): Promise<Stripe.Issuing.Cardholder> {
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
async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from === 'PYUSD' && to === 'USD') {
    return 1.0; // PYUSD is pegged to USD
  }

  // For other currencies, use a real exchange rate API
  const response = await axios.get<ExchangeRateResponse>(
    `https://api.exchangerate-api.com/v4/latest/${from}`
  );

  return response.data.rates[to];
}

// ============= START SERVER =============

app.listen(PORT, (): void => {
  console.log(`CryptoPay Backend running on port ${PORT}`);
  console.log(`Hot wallet: ${HOT_WALLET_ADDRESS}`);
});

export default app;
