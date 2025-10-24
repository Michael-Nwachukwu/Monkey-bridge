// CRITICAL: Import buffer setup FIRST before anything else
import './buffer-setup';

// NOW import Nexus SDK
import { NexusSDK } from '@avail-project/nexus-core';

console.log('[Nexus] Script loaded, Buffer check:', typeof (window as any).Buffer);

// EIP-6963 Provider Detection
const providers: any[] = [];

window.addEventListener('eip6963:announceProvider', (event: any) => {
  console.log('[Nexus] Provider announced:', event.detail.info.name);
  if (!providers.find((p: any) => p.info.name === event.detail.info.name)) {
    providers.push(event.detail);
  }
});

window.dispatchEvent(new Event('eip6963:requestProvider'));

console.log('[Nexus] Waiting for wallet providers...');

// Expose getNexusBalances immediately (will error if not initialized)
let nexusSDKInstance: any = null;
let nexusIsReady = false;

(window as any).getNexusBalances = async () => {
  if (!nexusIsReady || !nexusSDKInstance) {
    throw new Error('Nexus SDK is still initializing. Please wait a moment and try again.');
  }
  console.log('[Nexus] Fetching balances...');
  const balances = await nexusSDKInstance.getUnifiedBalances();
  console.log('[Nexus] Balances:', balances);
  return balances;
};

console.log('[Nexus] window.getNexusBalances() exposed (will initialize soon)');

// Initialize
setTimeout(async () => {
  console.log('[Nexus] Initializing... Found providers:', providers.length);

  if (providers.length === 0) {
    console.log('[Nexus] No wallet providers found');
    return;
  }

  try {
    console.log('[Nexus] Creating NexusSDK instance...');
    const nexusSDK = new NexusSDK();
    console.log('[Nexus] NexusSDK instance created:', nexusSDK);

    let isInitialized = false;

    for (const providerDetail of providers) {
      try {
        const provider = providerDetail.provider;
        console.log('[Nexus] Checking provider:', providerDetail.info.name);

        const accounts = await provider.request?.({ method: 'eth_accounts' });
        console.log('[Nexus] Provider accounts:', accounts);

        if (accounts && accounts.length > 0) {
          console.log('[Nexus] Initializing with provider:', providerDetail.info.name);
          console.log('[Nexus] About to call nexusSDK.initialize()...');

          // Add timeout to detect if initialize hangs
          const initPromise = nexusSDK.initialize(provider).then(() => {
            console.log('[Nexus] initPromise resolved!');
            return 'success';
          });

          const timeoutPromise = new Promise((_, reject) => {
            console.log('[Nexus] Setting 10s timeout...');
            setTimeout(() => {
              console.log('[Nexus] TIMEOUT FIRED!');
              reject(new Error('Initialize timeout after 10s'));
            }, 10000);
          });

          console.log('[Nexus] Racing promises...');
          await Promise.race([initPromise, timeoutPromise]);

          console.log('[Nexus] nexusSDK.initialize() completed');
          isInitialized = true;

          // Set global variables so getNexusBalances works
          nexusSDKInstance = nexusSDK;
          nexusIsReady = true;

          console.log('[Nexus] ✅ INITIALIZED SUCCESSFULLY');
          console.log('[Nexus] Ready! Call window.getNexusBalances()');

          (window as any).nexusSDK = nexusSDK;
          return;
        }
      } catch (error) {
        console.error('[Nexus] ❌ Error with provider:', providerDetail.info.name);
        console.error('[Nexus] Error details:', error);
        console.error('[Nexus] Error stack:', (error as Error).stack);
      }
    }

    console.log('[Nexus] No connected wallet found');
  } catch (error) {
    console.error('[Nexus] ❌ Failed to initialize - top level error');
    console.error('[Nexus] Error details:', error);
    console.error('[Nexus] Error stack:', (error as Error).stack);
  }
}, 1500);
