// Ethers-compatible provider that uses WalletBridge
// This makes WalletBridge work seamlessly with ethers.js

import WalletBridge from './WalletBridge';

interface RequestArguments {
    method: string;
    params?: any[];
}

type EventCallback = (data: any) => void;

class EthersProvider {
    private bridge: WalletBridge;

    constructor(walletBridge: WalletBridge) {
        this.bridge = walletBridge;
    }

    async request(args: RequestArguments): Promise<any> {
        const { method, params = [] } = args;

        if (method === 'eth_requestAccounts') {
            return await this.bridge.requestAccounts();
        }

        return await this.bridge.request(method, params);
    }

    async send(method: string, params: any[]): Promise<any> {
        return await this.request({ method, params });
    }

    on(event: string, callback: EventCallback): void {
        this.bridge.on(event, callback);
    }

    removeListener(event: string, callback: EventCallback): void {
        this.bridge.removeListener(event, callback);
    }
}

export default EthersProvider;
