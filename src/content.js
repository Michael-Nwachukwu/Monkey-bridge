// Content Script - Runs on every webpage to analyze checkout pages

// DOM Selectors for common checkout patterns
const CHECKOUT_PATTERNS = {
  // Common price selectors
  priceSelectors: [
    '[class*="total"] [class*="price"]',
    '[class*="total"] [class*="amount"]',
    '[id*="total"]',
    '[class*="grand-total"]',
    '[data-testid*="total"]',
    '.order-total',
    '#order-total',
    '.cart-total',
    '.checkout-total'
  ],

  // Common payment form fields
  paymentFields: {
    cardNumber: [
      'input[name*="cardnumber"]',
      'input[name*="card-number"]',
      'input[placeholder*="card number"]',
      '#card-number',
      '#cardNumber',
      'input[autocomplete="cc-number"]',
      '[data-testid*="card-number"]'
    ],
    cardExpiry: [
      'input[name*="expiry"]',
      'input[name*="exp-date"]',
      'input[autocomplete="cc-exp"]',
      '[placeholder*="MM/YY"]',
      '[placeholder*="expiry"]'
    ],
    cardCVV: [
      'input[name*="cvv"]',
      'input[name*="cvc"]',
      'input[autocomplete="cc-csc"]',
      '[placeholder*="CVV"]',
      '[placeholder*="CVC"]'
    ]
  },

  // Checkout indicators
  checkoutIndicators: [
    'checkout',
    'payment',
    'cart',
    'order-summary',
    'billing'
  ]
};

// Check if current page is a checkout page
function isCheckoutPage() {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  const bodyText = document.body.innerText.toLowerCase();

  return CHECKOUT_PATTERNS.checkoutIndicators.some(indicator =>
    url.includes(indicator) ||
    title.includes(indicator) ||
    bodyText.includes(indicator)
  );
}

// Extract checkout data using script-based approach
function extractCheckoutDataScript() {
  const data = {
    url: window.location.href,
    timestamp: Date.now(),
    amount: null,
    currency: 'USD',
    merchantName: null,
    items: [],
    paymentFields: {}
  };

  // Try to find total amount
  for (const selector of CHECKOUT_PATTERNS.priceSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      const text = element.innerText || element.textContent;
      const priceMatch = text.match(/[\$€£]?\s*(\d+[,.]?\d*\.?\d*)/);
      if (priceMatch) {
        data.amount = parseFloat(priceMatch[1].replace(',', ''));

        // Extract currency
        if (text.includes('$')) data.currency = 'USD';
        else if (text.includes('€')) data.currency = 'EUR';
        else if (text.includes('£')) data.currency = 'GBP';

        break;
      }
    }
  }

  // Extract merchant name
  data.merchantName = document.querySelector('meta[property="og:site_name"]')?.content ||
                      document.querySelector('title')?.innerText?.split('|')[0]?.trim() ||
                      window.location.hostname;

  // Find payment form fields
  for (const [fieldType, selectors] of Object.entries(CHECKOUT_PATTERNS.paymentFields)) {
    for (const selector of selectors) {
      const field = document.querySelector(selector);
      if (field) {
        data.paymentFields[fieldType] = {
          selector: selector,
          id: field.id,
          name: field.name,
          xpath: getXPath(field)
        };
        break;
      }
    }
  }

  return data;
}

// Get XPath of an element
function getXPath(element) {
  if (element.id) return `//*[@id="${element.id}"]`;
  if (element === document.body) return '/html/body';

  let ix = 0;
  const siblings = element.parentNode?.childNodes || [];

  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling === element) {
      return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
    }
    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
      ix++;
    }
  }
}

// Extract page screenshot for AI analysis
async function capturePageContext() {
  return {
    html: document.documentElement.outerHTML,
    url: window.location.href,
    title: document.title,
    // Capture visible text content
    visibleText: Array.from(document.querySelectorAll('body *'))
      .filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map(el => el.innerText)
      .filter(text => text && text.trim().length > 0)
      .slice(0, 100) // Limit to first 100 text elements
      .join('\n'),
    // Capture form structure
    forms: Array.from(document.forms).map(form => ({
      action: form.action,
      method: form.method,
      fields: Array.from(form.elements).map(el => ({
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder
      }))
    }))
  };
}

// Fill payment form with virtual card data
function fillPaymentForm(virtualCardData) {
  const { cardNumber, expiry, cvv } = virtualCardData;

  // Find and fill card number
  const cardField = findElement(CHECKOUT_PATTERNS.paymentFields.cardNumber);
  if (cardField) {
    setNativeValue(cardField, cardNumber);
    cardField.dispatchEvent(new Event('input', { bubbles: true }));
    cardField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Fill expiry
  const expiryField = findElement(CHECKOUT_PATTERNS.paymentFields.cardExpiry);
  if (expiryField) {
    setNativeValue(expiryField, expiry);
    expiryField.dispatchEvent(new Event('input', { bubbles: true }));
    expiryField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Fill CVV
  const cvvField = findElement(CHECKOUT_PATTERNS.paymentFields.cardCVV);
  if (cvvField) {
    setNativeValue(cvvField, cvv);
    cvvField.dispatchEvent(new Event('input', { bubbles: true }));
    cvvField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return {
    success: !!(cardField && expiryField && cvvField),
    filledFields: {
      cardNumber: !!cardField,
      expiry: !!expiryField,
      cvv: !!cvvField
    }
  };
}

// Helper to find element from multiple selectors
function findElement(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

// Properly set value on React/Vue controlled inputs
function setNativeValue(element, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set ||
                      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;

  if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkIfCheckout') {
    sendResponse({ isCheckout: isCheckoutPage() });
  }

  if (request.action === 'parsePageScript') {
    const data = extractCheckoutDataScript();
    sendResponse({ success: true, data });
  }

  if (request.action === 'parsePageAI') {
    capturePageContext().then(context => {
      sendResponse({ success: true, context });
    });
    return true; // Async response
  }

  if (request.action === 'fillPaymentForm') {
    const result = fillPaymentForm(request.virtualCard);
    sendResponse(result);
  }

  if (request.action === 'highlightFields') {
    // Visual feedback - highlight detected payment fields
    const cardField = findElement(CHECKOUT_PATTERNS.paymentFields.cardNumber);
    if (cardField) {
      cardField.style.border = '2px solid #10b981';
      cardField.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.5)';
    }
    sendResponse({ highlighted: true });
  }
});

// Auto-detect checkout pages and notify extension
if (isCheckoutPage()) {
  chrome.runtime.sendMessage({
    action: 'checkoutDetected',
    url: window.location.href
  });
}
