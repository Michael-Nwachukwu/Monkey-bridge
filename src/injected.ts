// Injected script - runs in page context to access window.ethereum
// This script bridges wallet providers to the extension

// Extend window interface to include ethereum
declare global {
    interface Window {
        ethereum?: {
            request: (args: { method: string; params?: any[] }) => Promise<any>;
            on: (event: string, callback: (...args: any[]) => void) => void;
            isMetaMask?: boolean;
            isRabby?: boolean;
        };
    }
}

// Message payload interface
interface MessagePayload {
    method?: string;
    params?: any[];
}

// Message data interface
interface MessageData {
    type: string;
    payload?: MessagePayload;
    requestId?: string;
}

// Response data interface
interface ResponseData {
    type: string;
    requestId?: string;
    success?: boolean;
    data?: any;
    error?: string;
    event?: string;
    hasProvider?: boolean;
}

// Wallet check result interface
interface WalletCheckResult {
    hasProvider: boolean;
    isMetaMask: boolean;
    isRabby: boolean;
}

(function() {
    'use strict';

    console.log('🔵 [INJECTED] Script loaded in page context');

    // Check if ethereum provider is available
    const hasEthereum = typeof window.ethereum !== 'undefined';
    console.log('🔵 [INJECTED] window.ethereum exists?', hasEthereum);

    if (hasEthereum) {
        console.log('🔵 [INJECTED] Wallet detected:', {
            isMetaMask: window.ethereum!.isMetaMask,
            isRabby: window.ethereum!.isRabby
        });
    }

    // Listen for requests from content script
    window.addEventListener('message', async (event: MessageEvent) => {
        // Only accept messages from same window
        if (event.source !== window) return;

        const { type, payload, requestId }: MessageData = event.data;

        if (!type || !type.startsWith('WALLET_')) return;

        try {
            let result: any;

            switch (type) {
                case 'WALLET_CHECK':
                    result = {
                        hasProvider: hasEthereum,
                        isMetaMask: window.ethereum?.isMetaMask || false,
                        isRabby: window.ethereum?.isRabby || false
                    } as WalletCheckResult;
                    break;

                case 'WALLET_REQUEST':
                    if (!hasEthereum) {
                        throw new Error('No wallet provider found');
                    }
                    result = await window.ethereum!.request(payload!);
                    break;

                case 'WALLET_SEND':
                    if (!hasEthereum) {
                        throw new Error('No wallet provider found');
                    }
                    result = await window.ethereum!.request({
                        method: payload!.method!,
                        params: payload!.params || []
                    });
                    break;

                default:
                    throw new Error(`Unknown request type: ${type}`);
            }

            // Send success response
            window.postMessage({
                type: 'WALLET_RESPONSE',
                requestId,
                success: true,
                data: result
            } as ResponseData, '*');

        } catch (error) {
            // Send error response
            window.postMessage({
                type: 'WALLET_RESPONSE',
                requestId,
                success: false,
                error: (error as Error).message
            } as ResponseData, '*');
        }
    });

    // Listen for wallet events and forward them
    if (hasEthereum) {
        window.ethereum!.on('accountsChanged', (accounts: string[]) => {
            window.postMessage({
                type: 'WALLET_EVENT',
                event: 'accountsChanged',
                data: accounts
            } as ResponseData, '*');
        });

        window.ethereum!.on('chainChanged', (chainId: string) => {
            window.postMessage({
                type: 'WALLET_EVENT',
                event: 'chainChanged',
                data: chainId
            } as ResponseData, '*');
        });

        window.ethereum!.on('connect', (connectInfo: any) => {
            window.postMessage({
                type: 'WALLET_EVENT',
                event: 'connect',
                data: connectInfo
            } as ResponseData, '*');
        });

        window.ethereum!.on('disconnect', (error: any) => {
            window.postMessage({
                type: 'WALLET_EVENT',
                event: 'disconnect',
                data: error
            } as ResponseData, '*');
        });
    }

    // Notify that injected script is ready
    console.log('🔵 [INJECTED] Sending WALLET_READY message, hasProvider:', hasEthereum);
    window.postMessage({
        type: 'WALLET_READY',
        hasProvider: hasEthereum
    } as ResponseData, '*');
})();
