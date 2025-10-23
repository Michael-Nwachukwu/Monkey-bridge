// SIMPLE: Just initialize Nexus SDK in page context
import { Buffer } from 'buffer';
import { NexusSDK } from '@avail-project/nexus-core';

// Setup globals
(window as any).Buffer = Buffer;
(globalThis as any).Buffer = Buffer;

if (typeof process === 'undefined') {
  (window as any).process = {
    env: {},
    version: '',
    versions: {},
    nextTick: (fn: Function) => Promise.resolve().then(() => fn())
  };
}

console.log('[Nexus] Script loaded');

// EIP-6963 Provider Detection
const providers: any[] = [];

window.addEventListener('eip6963:announceProvider', (event: any) => {
  console.log('[Nexus] Provider announced:', event.detail.info.name);
  if (!providers.find((p) => p.info.name === event.detail.info.name)) {
    providers.push(event.detail);
  }
});

// Request providers
window.dispatchEvent(new Event('eip6963:requestProvider'));

// Initialize Nexus
const nexusSDK = new NexusSDK();
let isInitialized = false;

async function initNexus() {
  console.log('[Nexus] Initializing... Found providers:', providers.length);

  // Wait for providers
  await new Promise(resolve => setTimeout(resolve, 1000));

  for (const providerDetail of providers) {
    try {
      const provider = providerDetail.provider;
      const accounts = await provider.request?.({ method: 'eth_accounts' });

      if (accounts && accounts.length > 0) {
        console.log('[Nexus] Initializing with provider:', providerDetail.info.name);
        await nexusSDK.initialize(provider);
        isInitialized = true;
        console.log('[Nexus] ✅ INITIALIZED SUCCESSFULLY');

        // Make it globally available
        (window as any).nexusSDK = nexusSDK;

        return;
      }
    } catch (error) {
      console.error('[Nexus] Error with provider:', error);
    }
  }

  console.log('[Nexus] No connected wallet found');
}

// Start initialization
initNexus();

// Export for extension use
(window as any).getNexusBalances = async () => {
  if (!isInitialized) {
    throw new Error('Nexus not initialized');
  }
  return await nexusSDK.getUnifiedBalances();
};

console.log('[Nexus] Setup complete');
