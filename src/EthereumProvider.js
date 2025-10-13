// Ethereum Provider Bridge for Side Panel
// Mimics window.ethereum API but communicates with injected wallet via content script

class EthereumProvider {
    constructor() {
        this.requestId = 0;
        this.pendingRequests = new Map();
        this.eventListeners = new Map();
        this.isConnected = false;
        this._initialized = false;
        this._initPromise = null;

        // Listen for messages from background script (forwarded from content script)
        chrome.runtime.onMessage.addListener((message) => {
            this._handleMessage(message);
        });
    }

    async initialize() {
        if (this._initialized) {
            console.log('🟣 [PROVIDER] Already initialized');
            return true;
        }
        if (this._initPromise) {
            console.log('🟣 [PROVIDER] Initialization in progress');
            return this._initPromise;
        }

        console.log('🟣 [PROVIDER] Starting initialization');

        this._initPromise = new Promise(async (resolve) => {
            try {
                // Get active tab - use lastFocusedWindow for side panel compatibility
                const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

                if (!tab) {
                    console.error('🔴 [PROVIDER] No active tab found');
                    resolve(false);
                    return;
                }

                console.log('🟣 [PROVIDER] Active tab:', tab.id, tab.url);
                this.currentTabId = tab.id;

                // Retry logic - content script might not be ready yet
                let attempts = 0;
                const maxAttempts = 5;
                const retryDelay = 500; // ms

                while (attempts < maxAttempts) {
                    try {
                        console.log('🟣 [PROVIDER] Sending checkWallet message to tab', tab.id, `(attempt ${attempts + 1}/${maxAttempts})`);

                        const response = await chrome.tabs.sendMessage(tab.id, {
                            action: 'checkWallet'
                        });

                        console.log('🟣 [PROVIDER] checkWallet response:', response);

                        if (response && response.hasWallet !== undefined) {
                            if (response.hasWallet) {
                                this._initialized = true;
                                console.log('✅ [PROVIDER] Wallet detected and initialized');
                                resolve(true);
                            } else {
                                console.log('❌ [PROVIDER] No wallet detected');
                                resolve(false);
                            }
                            return;
                        }

                        // If response is undefined or invalid, retry
                        attempts++;
                        if (attempts < maxAttempts) {
                            await new Promise(r => setTimeout(r, retryDelay));
                        }
                    } catch (error) {
                        console.log('🟡 [PROVIDER] Attempt failed:', error.message);
                        attempts++;
                        if (attempts < maxAttempts) {
                            await new Promise(r => setTimeout(r, retryDelay));
                        }
                    }
                }

                console.error('🔴 [PROVIDER] Failed to initialize after', maxAttempts, 'attempts');
                resolve(false);
            } catch (error) {
                console.error('🔴 [PROVIDER] Failed to initialize wallet provider:', error);
                resolve(false);
            }
        });

        return this._initPromise;
    }

    _handleMessage(message) {
        if (message.type === 'WALLET_RESPONSE') {
            const { requestId, success, data, error } = message;
            const pending = this.pendingRequests.get(requestId);

            if (pending) {
                this.pendingRequests.delete(requestId);
                if (success) {
                    pending.resolve(data);
                } else {
                    pending.reject(new Error(error));
                }
            }
        }

        if (message.type === 'WALLET_EVENT') {
            const { event, data } = message;
            this._emit(event, data);
        }

        if (message.type === 'WALLET_READY') {
            this._initialized = message.hasProvider;
        }
    }

    async request(args) {
        if (!this._initialized) {
            const initialized = await this.initialize();
            if (!initialized) {
                throw new Error('No wallet provider found. Please install MetaMask or Rabby.');
            }
        }

        const requestId = ++this.requestId;

        const promise = new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject });

            // Timeout after 60 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('Wallet request timeout'));
                }
            }, 60000);
        });

        // Send request to content script
        try {
            if (!this.currentTabId) {
                const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                if (!tab) {
                    throw new Error('No active tab found');
                }
                this.currentTabId = tab.id;
            }

            await chrome.tabs.sendMessage(this.currentTabId, {
                action: 'walletRequest',
                type: 'WALLET_REQUEST',
                payload: args,
                requestId
            });
        } catch (error) {
            this.pendingRequests.delete(requestId);
            throw new Error('Failed to communicate with wallet: ' + error.message);
        }

        return promise;
    }

    // Event listeners
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }

    removeListener(event, callback) {
        if (this.eventListeners.has(event)) {
            const callbacks = this.eventListeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    _emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('Error in event listener:', error);
                }
            });
        }
    }

    // Check if wallet is available
    static async isAvailable() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (!tab) return false;

            // Add retry logic for content script readiness
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                try {
                    const response = await chrome.tabs.sendMessage(tab.id, {
                        action: 'checkWallet'
                    });

                    if (response && response.hasWallet !== undefined) {
                        return response.hasWallet;
                    }

                    attempts++;
                    if (attempts < maxAttempts) {
                        await new Promise(r => setTimeout(r, 300));
                    }
                } catch (error) {
                    attempts++;
                    if (attempts < maxAttempts) {
                        await new Promise(r => setTimeout(r, 300));
                    }
                }
            }

            return false;
        } catch (error) {
            return false;
        }
    }
}

export default EthereumProvider;
