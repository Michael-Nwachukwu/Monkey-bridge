// Wallet Provider Bridge for Side Panel
// Communicates with injected script to access window.ethereum

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

interface WalletMessage {
    type: string;
    requestId?: number;
    success?: boolean;
    data?: any;
    error?: string;
    event?: string;
    hasProvider?: boolean;
}

interface RequestArguments {
    method?: string;
    params?: any[];
}

type EventCallback = (data: any) => void;

class WalletProvider {
    private requestId: number;
    private pendingRequests: Map<number, PendingRequest>;
    private listeners: Map<string, EventCallback[]>;
    private isReady: boolean;
    private hasProvider: boolean;

    constructor() {
        this.requestId = 0;
        this.pendingRequests = new Map<number, PendingRequest>();
        this.listeners = new Map<string, EventCallback[]>();
        this.isReady = false;
        this.hasProvider = false;

        this.setupMessageListener();
        this.injectScript();
    }

    private setupMessageListener(): void {
        // Listen for messages from content script
        chrome.runtime.onMessage.addListener((message: WalletMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
            if (message.type === 'WALLET_RESPONSE') {
                const { requestId, success, data, error } = message;
                const pending = this.pendingRequests.get(requestId!);

                if (pending) {
                    this.pendingRequests.delete(requestId!);
                    if (success) {
                        pending.resolve(data);
                    } else {
                        pending.reject(new Error(error));
                    }
                }
            }

            if (message.type === 'WALLET_EVENT') {
                const { event, data } = message;
                this.emit(event!, data);
            }

            if (message.type === 'WALLET_READY') {
                this.isReady = true;
                this.hasProvider = message.hasProvider!;
                this.emit('ready', { hasProvider: this.hasProvider });
            }
        });
    }

    private async injectScript(): Promise<void> {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.id) {
                console.error('No active tab found');
                return;
            }

            // Send message to content script to inject wallet script
            await chrome.tabs.sendMessage(tab.id, {
                action: 'injectWalletProvider'
            });
        } catch (error) {
            console.error('Failed to inject wallet provider:', error);
        }
    }

    async request(args: RequestArguments): Promise<any> {
        if (!this.hasProvider) {
            throw new Error('No wallet provider found');
        }

        const requestId = ++this.requestId;

        const promise = new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });

        // Send request to content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'walletRequest',
                    type: 'WALLET_REQUEST',
                    payload: args,
                    requestId
                });
            }
        });

        return promise;
    }

    on(event: string, callback: EventCallback): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(callback);
    }

    removeListener(event: string, callback: EventCallback): void {
        if (this.listeners.has(event)) {
            const callbacks = this.listeners.get(event)!;
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    private emit(event: string, data: any): void {
        if (this.listeners.has(event)) {
            this.listeners.get(event)!.forEach(callback => callback(data));
        }
    }

    async waitForReady(timeout: number = 5000): Promise<{ hasProvider: boolean }> {
        if (this.isReady) {
            return { hasProvider: this.hasProvider };
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.removeListener('ready', handler);
                reject(new Error('Wallet provider initialization timeout'));
            }, timeout);

            const handler = (data: { hasProvider: boolean }) => {
                clearTimeout(timer);
                resolve(data);
            };

            this.on('ready', handler);
        });
    }
}

export default WalletProvider;
