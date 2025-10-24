// Content Script - Runs on every webpage
import browser from 'webextension-polyfill';

console.log('[Content] 🚀 Content script loaded!');

// Inject Nexus script into page context - EXACTLY like Nexus extension does
const injectNexusScript = () => {
  const container = document.head || document.documentElement;
  const script = document.createElement('script');
  const scriptUrl = browser.runtime.getURL('injected-nexus.js');
  script.setAttribute('src', scriptUrl);
  container.append(script);
  console.log('[Content] ✅ Nexus script injected! URL:', scriptUrl);
  script.remove(); // Remove tag after execution (script still runs)
};

// ONLY inject Nexus on checkout pages - don't spam every tab!
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (isCheckoutPage()) {
      console.log('[Content] Checkout page detected, injecting Nexus...');
      injectNexusScript();
    } else {
      console.log('[Content] Not a checkout page, skipping Nexus injection');
    }
  });
} else {
  // DOM already loaded
  if (isCheckoutPage()) {
    console.log('[Content] Checkout page detected, injecting Nexus...');
    injectNexusScript();
  } else {
    console.log('[Content] Not a checkout page, skipping Nexus injection');
  }
}

// Payment field info interface
interface PaymentFieldInfo {
    selector: string;
    id: string;
    name: string;
    xpath: string;
}

// Checkout data interface
interface CheckoutData {
    url: string;
    timestamp: number;
    amount: number | null;
    currency: string;
    merchantName: string | null;
    items: any[];
    paymentFields: Record<string, PaymentFieldInfo>;
}

// Page context interface
interface PageContext {
    html: string;
    url: string;
    title: string;
    visibleText: string;
    forms: FormInfo[];
}

// Form info interface
interface FormInfo {
    action: string;
    method: string;
    fields: FormFieldInfo[];
}

// Form field info interface
interface FormFieldInfo {
    type: string;
    name: string;
    id: string;
    placeholder: string;
}

// Virtual card data interface
interface VirtualCardData {
    cardNumber: string;
    expiry: string;
    cvv: string;
}

// Fill result interface
interface FillResult {
    success: boolean;
    filledFields: {
        cardNumber: boolean;
        expiry: boolean;
        cvv: boolean;
    };
}

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
function isCheckoutPage(): boolean {
  // Safety check - don't run if body isn't ready
  if (!document.body) {
    return false;
  }

  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  const bodyText = document.body.innerText?.toLowerCase() || '';

  return CHECKOUT_PATTERNS.checkoutIndicators.some(indicator =>
    url.includes(indicator) ||
    title.includes(indicator) ||
    bodyText.includes(indicator)
  );
}

// Extract checkout data using script-based approach
function extractCheckoutDataScript(): CheckoutData {
  const data: CheckoutData = {
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
      const text = element.textContent || '';
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
  data.merchantName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
                      document.querySelector('title')?.textContent?.split('|')[0]?.trim() ||
                      window.location.hostname;

  // Find payment form fields
  for (const [fieldType, selectors] of Object.entries(CHECKOUT_PATTERNS.paymentFields)) {
    for (const selector of selectors) {
      const field = document.querySelector(selector) as HTMLInputElement | null;
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
function getXPath(element: Element): string {
  if (element.id) return `//*[@id="${element.id}"]`;
  if (element === document.body) return '/html/body';

  let ix = 0;
  const siblings = element.parentNode?.childNodes || [];

  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling === element) {
      return getXPath(element.parentNode as Element) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
    }
    if (sibling.nodeType === 1 && (sibling as Element).tagName === element.tagName) {
      ix++;
    }
  }

  return '';
}

// Extract page screenshot for AI analysis
async function capturePageContext(): Promise<PageContext> {
  return {
    html: document.documentElement.outerHTML,
    url: window.location.href,
    title: document.title,
    // Capture visible text content
    visibleText: Array.from(document.querySelectorAll('body *'))
      .filter((el: Element) => {
        const style = window.getComputedStyle(el as HTMLElement);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((el: Element) => el.textContent || '')
      .filter((text: string) => text && text.trim().length > 0)
      .slice(0, 100) // Limit to first 100 text elements
      .join('\n'),
    // Capture form structure
    forms: Array.from(document.forms).map((form: HTMLFormElement) => ({
      action: form.action,
      method: form.method,
      fields: Array.from(form.elements).map((el: Element) => {
        const input = el as HTMLInputElement;
        return {
          type: input.type,
          name: input.name,
          id: input.id,
          placeholder: input.placeholder
        };
      })
    }))
  };
}

// Fill payment form with virtual card data
function fillPaymentForm(virtualCardData: VirtualCardData): FillResult {
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
function findElement(selectors: string[]): HTMLInputElement | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector) as HTMLInputElement | null;
    if (el) return el;
  }
  return null;
}

// Properly set value on React/Vue controlled inputs
function setNativeValue(element: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set ||
                      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;

  if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  // Handle Nexus messages to forward to page
  if (request.action === 'sendToPage') {
    window.postMessage(request.message, '*');
    sendResponse({ success: true });
    return true;
  }

  // Check if Nexus script is ready
  if (request.action === 'checkNexusReady') {
    // Post a message to page asking for status
    window.postMessage({ type: 'NEXUS_CHECK_READY' }, '*');

    // Listen for response
    const listener = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data.type === 'NEXUS_SCRIPT_READY') {
        window.removeEventListener('message', listener);
        sendResponse({ ready: true });
      }
    };

    window.addEventListener('message', listener);

    // Timeout after 100ms
    setTimeout(() => {
      window.removeEventListener('message', listener);
      sendResponse({ ready: false });
    }, 100);

    return true; // Async response
  }

  if (request.action === 'checkIfCheckout') {
    sendResponse({ isCheckout: isCheckoutPage() });
    return true;
  }

  if (request.action === 'parsePageScript') {
    const data = extractCheckoutDataScript();
    sendResponse({ success: true, data });
    return true;
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
    return true;
  }

  if (request.action === 'highlightFields') {
    // Visual feedback - highlight detected payment fields
    const cardField = findElement(CHECKOUT_PATTERNS.paymentFields.cardNumber);
    if (cardField) {
      cardField.style.border = '2px solid #10b981';
      cardField.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.5)';
    }
    sendResponse({ highlighted: true });
    return true;
  }

  return false;
});

// Auto-detect checkout pages and notify extension
// Wait for DOM to be ready before checking
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (isCheckoutPage()) {
      chrome.runtime.sendMessage({
        action: 'checkoutDetected',
        url: window.location.href
      });
    }
  });
} else {
  // DOM already loaded
  if (isCheckoutPage()) {
    chrome.runtime.sendMessage({
      action: 'checkoutDetected',
      url: window.location.href
    });
  }
}
