// Client that communicates with Nexus via page context injection
// Runs in the extension popup context
import browser from 'webextension-polyfill';

export interface UnifiedBalance {
  chainId: number;
  chainName: string;
  token: string;
  balance: number;
  decimals: number;
}

export interface BridgeParams {
  fromChainId: number;
  toChainId: number;
  token: string;
  amount: number;
  recipient?: string;
}

export interface TransferResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

class NexusClient {
  private requestId = 0;
  private pendingRequests: Map<number, {resolve: Function, reject: Function, timeout: NodeJS.Timeout}> = new Map();
  private initialized = false;
  private scriptReady = false;

  constructor() {
    this.setupMessageListener();
  }

  private setupMessageListener() {
    // Listen for messages forwarded from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'nexusMessage') {
        this.handleNexusMessage(request.data);
      }
    });
  }

  private handleNexusMessage(data: any) {
    const { type, requestId, success, error, data: responseData } = data;

    if (type === 'NEXUS_SCRIPT_READY') {
      this.scriptReady = true;
      console.log('[NexusClient] Nexus script ready in page context');
      return;
    }

    if (!type || !type.endsWith('_RESPONSE')) return;

    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    if (success) {
      pending.resolve(responseData);
    } else {
      pending.reject(new Error(error || 'Request failed'));
    }
  }

  private async sendMessageToPage(type: string, payload: any = {}): Promise<any> {
    return new Promise(async (resolve, reject) => {
      const requestId = ++this.requestId;

      // 30 second timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 30000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      // Send message to active tab's content script, which will forward to page
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          throw new Error('No active tab found');
        }

        await chrome.tabs.sendMessage(tab.id, {
          action: 'sendToPage',
          message: {
            type,
            requestId,
            payload
          }
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  async waitForScript(maxWait = 5000): Promise<boolean> {
    // If already marked as ready, return immediately
    if (this.scriptReady) return true;

    const start = Date.now();

    // Try checking if script is ready via content script
    while (Date.now() - start < maxWait) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'checkNexusReady'
          });

          if (response?.ready) {
            this.scriptReady = true;
            return true;
          }
        }
      } catch (error) {
        console.log('[NexusClient] Waiting for content script...', error);
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return this.scriptReady;
  }

  async initialize(provider: any): Promise<void> {
    const ready = await this.waitForScript();
    if (!ready) {
      throw new Error('Nexus script not ready in page context');
    }

    await this.sendMessageToPage('NEXUS_INIT', { provider });
    this.initialized = true;
  }

  async getUnifiedBalances(): Promise<UnifiedBalance[]> {
    if (!this.initialized) {
      throw new Error('Nexus not initialized. Call initialize() first.');
    }

    return await this.sendMessageToPage('NEXUS_GET_BALANCES');
  }

  async bridgeTokens(params: BridgeParams): Promise<TransferResult> {
    if (!this.initialized) {
      throw new Error('Nexus not initialized. Call initialize() first.');
    }

    try {
      const result = await this.sendMessageToPage('NEXUS_BRIDGE', params);
      return {
        success: true,
        txHash: result.txHash
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getSwapQuote(params: any): Promise<number> {
    if (!this.initialized) {
      throw new Error('Nexus not initialized. Call initialize() first.');
    }

    return await this.sendMessageToPage('NEXUS_GET_QUOTE', params);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isScriptReady(): boolean {
    return this.scriptReady;
  }
}

// Export singleton instance
export default new NexusClient();
