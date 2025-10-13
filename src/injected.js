// Injected script - runs in page context to access window.ethereum
// This script bridges wallet providers to the extension

(function() {
    'use strict';

    console.log('🔵 [INJECTED] Script loaded in page context');

    // Check if ethereum provider is available
    const hasEthereum = typeof window.ethereum !== 'undefined';
    console.log('🔵 [INJECTED] window.ethereum exists?', hasEthereum);

    if (hasEthereum) {
        console.log('🔵 [INJECTED] Wallet detected:', {
            isMetaMask: window.ethereum.isMetaMask,
            isRabby: window.ethereum.isRabby
        });
    }

    // Listen for requests from content script
    window.addEventListener('message', async (event) => {
        // Only accept messages from same window
        if (event.source !== window) return;

        const { type, payload, requestId } = event.data;

        if (!type || !type.startsWith('WALLET_')) return;

        try {
            let result;

            switch (type) {
                case 'WALLET_CHECK':
                    result = {
                        hasProvider: hasEthereum,
                        isMetaMask: window.ethereum?.isMetaMask,
                        isRabby: window.ethereum?.isRabby
                    };
                    break;

                case 'WALLET_REQUEST':
                    if (!hasEthereum) {
                        throw new Error('No wallet provider found');
                    }
                    result = await window.ethereum.request(payload);
                    break;

                case 'WALLET_SEND':
                    if (!hasEthereum) {
                        throw new Error('No wallet provider found');
                    }
                    result = await window.ethereum.request({
                        method: payload.method,
                        params: payload.params || []
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
            }, '*');

        } catch (error) {
            // Send error response
            window.postMessage({
                type: 'WALLET_RESPONSE',
                requestId,
                success: false,
                error: error.message
            }, '*');
        }
    });

    // Listen for wallet events and forward them
    if (hasEthereum) {
        window.ethereum.on('accountsChanged', (accounts) => {
            window.postMessage({
                type: 'WALLET_EVENT',
                event: 'accountsChanged',
                data: accounts
            }, '*');
        });

        window.ethereum.on('chainChanged', (chainId) => {
            window.postMessage({
                type: 'WALLET_EVENT',
                event: 'chainChanged',
                data: chainId
            }, '*');
        });

        window.ethereum.on('connect', (connectInfo) => {
            window.postMessage({
                type: 'WALLET_EVENT',
                event: 'connect',
                data: connectInfo
            }, '*');
        });

        window.ethereum.on('disconnect', (error) => {
            window.postMessage({
                type: 'WALLET_EVENT',
                event: 'disconnect',
                data: error
            }, '*');
        });
    }

    // Notify that injected script is ready
    console.log('🔵 [INJECTED] Sending WALLET_READY message, hasProvider:', hasEthereum);
    window.postMessage({
        type: 'WALLET_READY',
        hasProvider: hasEthereum
    }, '*');
})();
