// Simple Wallet Bridge using chrome.scripting.executeScript with world: 'MAIN'
// This directly accesses window.ethereum in the page context

interface WalletInfo {
    hasWallet: boolean;
    isMetaMask?: boolean;
    isRabby?: boolean;
    error?: string;
}

interface ScriptExecutionResult<T> {
    result?: T;
    error?: string;
}

type EventCallback = (data: any) => void;

class WalletBridge {
    private tabId: number | null;
    private eventListeners: Map<string, EventCallback[]>;
    private _messageListener: ((message: any) => void) | null;

    constructor() {
        this.tabId = null;
        this.eventListeners = new Map<string, EventCallback[]>();
        this._messageListener = null;
    }

    async getActiveTab(): Promise<chrome.tabs.Tab> {
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
        this.tabId = tab.id!;
        return tab;
    }

    async checkWalletAvailable(): Promise<WalletInfo> {
        try {
            console.log('🔵 [WalletBridge] checkWalletAvailable - starting');
            const tab = await this.getActiveTab();
            console.log('🔵 [WalletBridge] Got active tab:', tab.id, tab.url);

            // Check if we can inject into this tab
            if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') ||
                tab.url?.startsWith('about:') || tab.url?.startsWith('edge://')) {
                console.warn('⚠️ [WalletBridge] Cannot inject into restricted page:', tab.url);
                return { hasWallet: false, error: 'Restricted page - please navigate to a regular website' };
            }

            console.log('🔵 [WalletBridge] Executing script to check for window.ethereum');
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id! },
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
            return { hasWallet: false, error: (error as Error).message };
        }
    }

    async requestAccounts(): Promise<string[]> {
        const tab = await this.getActiveTab();

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            world: 'MAIN',
            func: async () => {
                if (typeof window.ethereum === 'undefined') {
                    throw new Error('No wallet provider found');
                }
                return await window.ethereum.request({ method: 'eth_requestAccounts' });
            }
        });

        return results[0]?.result as string[];
    }

    async request(method: string, params: any[] = []): Promise<any> {
        const tab = await this.getActiveTab();

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            world: 'MAIN',
            args: [method, params],
            func: async (method: string, params: any[]) => {
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

    async setupEventListeners(): Promise<void> {
        const tab = await this.getActiveTab();

        // Inject event listener setup in MAIN world
        await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            world: 'MAIN',
            func: () => {
                if (typeof window.ethereum === 'undefined') return;

                // Setup event forwarding to extension
                const forwardEvent = (eventName: string, data: any) => {
                    window.postMessage({
                        type: 'WALLET_EVENT',
                        event: eventName,
                        data: data
                    }, '*');
                };

                // Only setup listeners once
                if (!(window as any).__walletListenersSetup) {
                    window.ethereum.on('accountsChanged', (accounts: string[]) => forwardEvent('accountsChanged', accounts));
                    window.ethereum.on('chainChanged', (chainId: string) => forwardEvent('chainChanged', chainId));
                    window.ethereum.on('connect', (info: any) => forwardEvent('connect', info));
                    window.ethereum.on('disconnect', (error: any) => forwardEvent('disconnect', error));
                    (window as any).__walletListenersSetup = true;
                }
            }
        });

        // Setup message listener in content script to forward events
        await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            world: 'ISOLATED',
            func: () => {
                if ((window as any).__eventForwarderSetup) return;

                window.addEventListener('message', (event) => {
                    if (event.source !== window) return;
                    if (event.data?.type === 'WALLET_EVENT') {
                        chrome.runtime.sendMessage(event.data).catch(() => {});
                    }
                });

                (window as any).__eventForwarderSetup = true;
            }
        });

        // Listen for forwarded events
        if (!this._messageListener) {
            this._messageListener = (message: any) => {
                if (message.type === 'WALLET_EVENT') {
                    this._emit(message.event, message.data);
                }
            };
            chrome.runtime.onMessage.addListener(this._messageListener);
        }
    }

    on(event: string, callback: EventCallback): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event)!.push(callback);
    }

    removeListener(event: string, callback: EventCallback): void {
        if (this.eventListeners.has(event)) {
            const callbacks = this.eventListeners.get(event)!;
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    private _emit(event: string, data: any): void {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event)!.forEach(callback => {
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
