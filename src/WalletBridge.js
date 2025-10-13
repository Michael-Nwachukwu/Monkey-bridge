// Simple Wallet Bridge using chrome.scripting.executeScript with world: 'MAIN'
// This directly accesses window.ethereum in the page context

class WalletBridge {
    constructor() {
        this.tabId = null;
        this.eventListeners = new Map();
    }

    async getActiveTab() {
        if (this.tabId) {
            try {
                const tab = await chrome.tabs.get(this.tabId);
                if (tab) return tab;
            } catch (e) {
                // Tab no longer exists, clear it
                this.tabId = null;
            }
        }

        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab) {
            throw new Error('No active tab found');
        }
        this.tabId = tab.id;
        return tab;
    }

    async checkWalletAvailable() {
        try {
            console.log('🔵 [WalletBridge] checkWalletAvailable - starting');
            const tab = await this.getActiveTab();
            console.log('🔵 [WalletBridge] Got active tab:', tab.id, tab.url);

            // Check if we can inject into this tab
            if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
                tab.url.startsWith('about:') || tab.url.startsWith('edge://')) {
                console.warn('⚠️ [WalletBridge] Cannot inject into restricted page:', tab.url);
                return { hasWallet: false, error: 'Restricted page - please navigate to a regular website' };
            }

            console.log('🔵 [WalletBridge] Executing script to check for window.ethereum');
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: 'MAIN',
                func: () => {
                    console.log('🟢 [MAIN WORLD] Checking for window.ethereum');
                    const result = {
                        hasWallet: typeof window.ethereum !== 'undefined',
                        isMetaMask: window.ethereum?.isMetaMask || false,
                        isRabby: window.ethereum?.isRabby || false
                    };
                    console.log('🟢 [MAIN WORLD] Result:', result);
                    return result;
                }
            });

            console.log('🔵 [WalletBridge] Script execution results:', results);
            const result = results[0]?.result || { hasWallet: false };
            console.log('🔵 [WalletBridge] Final result:', result);
            return result;
        } catch (error) {
            console.error('🔴 [WalletBridge] Failed to check wallet:', error);
            return { hasWallet: false, error: error.message };
        }
    }

    async requestAccounts() {
        const tab = await this.getActiveTab();

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: async () => {
                if (typeof window.ethereum === 'undefined') {
                    throw new Error('No wallet provider found');
                }
                return await window.ethereum.request({ method: 'eth_requestAccounts' });
            }
        });

        return results[0]?.result;
    }

    async request(method, params = []) {
        const tab = await this.getActiveTab();

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            args: [method, params],
            func: async (method, params) => {
                if (typeof window.ethereum === 'undefined') {
                    throw new Error('No wallet provider found');
                }
                return await window.ethereum.request({ method, params });
            }
        });

        if (results[0]?.error) {
            throw new Error(results[0].error);
        }

        return results[0]?.result;
    }

    async setupEventListeners() {
        const tab = await this.getActiveTab();

        // Inject event listener setup in MAIN world
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => {
                if (typeof window.ethereum === 'undefined') return;

                // Setup event forwarding to extension
                const forwardEvent = (eventName, data) => {
                    window.postMessage({
                        type: 'WALLET_EVENT',
                        event: eventName,
                        data: data
                    }, '*');
                };

                // Only setup listeners once
                if (!window.__walletListenersSetup) {
                    window.ethereum.on('accountsChanged', (accounts) => forwardEvent('accountsChanged', accounts));
                    window.ethereum.on('chainChanged', (chainId) => forwardEvent('chainChanged', chainId));
                    window.ethereum.on('connect', (info) => forwardEvent('connect', info));
                    window.ethereum.on('disconnect', (error) => forwardEvent('disconnect', error));
                    window.__walletListenersSetup = true;
                }
            }
        });

        // Setup message listener in content script to forward events
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'ISOLATED',
            func: () => {
                if (window.__eventForwarderSetup) return;

                window.addEventListener('message', (event) => {
                    if (event.source !== window) return;
                    if (event.data?.type === 'WALLET_EVENT') {
                        chrome.runtime.sendMessage(event.data).catch(() => {});
                    }
                });

                window.__eventForwarderSetup = true;
            }
        });

        // Listen for forwarded events
        if (!this._messageListener) {
            this._messageListener = (message) => {
                if (message.type === 'WALLET_EVENT') {
                    this._emit(message.event, message.data);
                }
            };
            chrome.runtime.onMessage.addListener(this._messageListener);
        }
    }

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
}

export default WalletBridge;
