// This runs inside the iframe (extension context) where WASM is allowed
import './buffer-setup';
import { NexusSDK } from '@avail-project/nexus-core';

console.log('[Nexus Frame] Initializing in iframe...');

let nexusSDK: any = null;
let isInitialized = false;

// Listen for provider from parent window
window.addEventListener('message', async (event) => {
  console.log('[Nexus Frame] Received message:', event.data);

  const { type, requestId, provider } = event.data;

  try {
    if (type === 'INITIALIZE') {
      console.log('[Nexus Frame] Initializing with provider...');
      nexusSDK = new NexusSDK();
      await nexusSDK.initialize(provider);
      isInitialized = true;

      console.log('[Nexus Frame] ✅ Initialized successfully');

      // Notify parent window
      window.parent.postMessage({
        type: 'NEXUS_READY',
        requestId
      }, '*');
    }

    if (type === 'GET_BALANCES') {
      if (!isInitialized) {
        throw new Error('Nexus not initialized');
      }

      console.log('[Nexus Frame] Getting balances...');
      const balances = await nexusSDK.getUnifiedBalances();
      console.log('[Nexus Frame] Balances:', balances);

      window.parent.postMessage({
        type: 'BALANCES_RESPONSE',
        data: balances,
        requestId
      }, '*');
    }
  } catch (error: any) {
    console.error('[Nexus Frame] Error:', error);
    window.parent.postMessage({
      type: 'ERROR',
      error: error.message,
      requestId
    }, '*');
  }
});

console.log('[Nexus Frame] Ready to receive messages');
