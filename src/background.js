// Background Service Worker - Handles extension logic and messaging

const API_BASE_URL = 'https://your-backend-api.com'; // Replace with your backend URL

// State management
let activeTransactions = new Map();
let checkoutPages = new Set();

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('CryptoPay Extension Installed');

  // Set up default storage
  chrome.storage.local.set({
    apiKey: '',
    backendWallet: '',
    pyusdContractAddress: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8', // Ethereum mainnet PYUSD
    preferredNetwork: 'ethereum',
    transactions: []
  });
});

// Handle extension icon click - open side panel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Listen for checkout page detection
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkoutDetected') {
    checkoutPages.add(sender.tab.id);

    // Badge to show checkout detected
    chrome.action.setBadgeText({
      text: '💳',
      tabId: sender.tab.id
    });

    chrome.action.setBadgeBackgroundColor({
      color: '#10b981',
      tabId: sender.tab.id
    });

    // Notify popup if open
    chrome.runtime.sendMessage({
      action: 'checkoutPageFound',
      tabId: sender.tab.id,
      url: message.url
    }).catch(() => {}); // Ignore if popup not open
  }

  if (message.action === 'analyzePage') {
    analyzePage(sender.tab.id, message.useAI)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async
  }

  if (message.action === 'processCryptoPayment') {
    processCryptoPayment(message.paymentData)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async
  }

  if (message.action === 'getTransactionStatus') {
    getTransactionStatus(message.txId)
      .then(status => sendResponse({ success: true, status }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async
  }
});

// Analyze checkout page
async function analyzePage(tabId, useAI = false) {
  // First try script-based extraction
  const scriptResult = await chrome.tabs.sendMessage(tabId, {
    action: 'parsePageScript'
  });

  if (scriptResult.success && scriptResult.data.amount) {
    return {
      method: 'script',
      ...scriptResult.data
    };
  }

  // If script fails and AI is enabled, use AI
  if (useAI) {
    const contextResult = await chrome.tabs.sendMessage(tabId, {
      action: 'parsePageAI'
    });

    if (contextResult.success) {
      const aiAnalysis = await analyzeWithAI(contextResult.context);
      return {
        method: 'ai',
        ...aiAnalysis
      };
    }
  }

  throw new Error('Could not analyze checkout page');
}

// Send page data to backend for AI analysis
async function analyzeWithAI(pageContext) {
  const response = await fetch(`${API_BASE_URL}/api/analyze-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await getApiKey()}`
    },
    body: JSON.stringify(pageContext)
  });

  if (!response.ok) {
    throw new Error('AI analysis failed');
  }

  return await response.json();
}

// Process crypto payment flow
async function processCryptoPayment(paymentData) {
  const { txHash, amount, currency, checkoutData } = paymentData;

  // Create transaction record
  const transactionId = generateTransactionId();
  activeTransactions.set(transactionId, {
    id: transactionId,
    status: 'pending',
    cryptoTx: txHash,
    amount,
    currency,
    timestamp: Date.now()
  });

  try {
    // Step 1: Verify crypto payment on-chain
    const verifyResponse = await fetch(`${API_BASE_URL}/api/verify-crypto-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getApiKey()}`
      },
      body: JSON.stringify({
        transactionId,
        txHash,
        expectedAmount: amount,
        currency
      })
    });

    if (!verifyResponse.ok) {
      throw new Error('Crypto payment verification failed');
    }

    const verifyResult = await verifyResponse.json();

    // Update transaction status
    updateTransaction(transactionId, {
      status: 'verified',
      verificationData: verifyResult
    });

    // Step 2: Execute traditional payment via backend
    const executeResponse = await fetch(`${API_BASE_URL}/api/execute-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getApiKey()}`
      },
      body: JSON.stringify({
        transactionId,
        checkoutData,
        amount,
        currency
      })
    });

    if (!executeResponse.ok) {
      throw new Error('Payment execution failed');
    }

    const executeResult = await executeResponse.json();

    // Update transaction status
    updateTransaction(transactionId, {
      status: 'completed',
      paymentResult: executeResult
    });

    // Save to storage
    await saveTransaction(transactionId);

    return {
      success: true,
      transactionId,
      virtualCard: executeResult.virtualCard,
      message: 'Payment processed successfully'
    };

  } catch (error) {
    updateTransaction(transactionId, {
      status: 'failed',
      error: error.message
    });

    return {
      success: false,
      transactionId,
      error: error.message
    };
  }
}

// Get transaction status
async function getTransactionStatus(txId) {
  const localTx = activeTransactions.get(txId);

  if (localTx) {
    return localTx;
  }

  // Check backend
  const response = await fetch(`${API_BASE_URL}/api/transaction-status/${txId}`, {
    headers: {
      'Authorization': `Bearer ${await getApiKey()}`
    }
  });

  if (!response.ok) {
    throw new Error('Transaction not found');
  }

  return await response.json();
}

// Helper functions
function generateTransactionId() {
  return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function updateTransaction(txId, updates) {
  const tx = activeTransactions.get(txId);
  if (tx) {
    activeTransactions.set(txId, { ...tx, ...updates });
  }
}

async function saveTransaction(txId) {
  const tx = activeTransactions.get(txId);
  if (!tx) return;

  const { transactions = [] } = await chrome.storage.local.get('transactions');
  transactions.push(tx);

  await chrome.storage.local.set({ transactions });
}

async function getApiKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  return apiKey || '';
}

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  checkoutPages.delete(tabId);
});

// Listen for network changes to update badge
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // Clear badge if not checkout page
    if (!checkoutPages.has(tabId)) {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});
