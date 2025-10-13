// Ethers-compatible provider that uses WalletBridge
// This makes WalletBridge work seamlessly with ethers.js

class EthersProvider {
    constructor(walletBridge) {
        this.bridge = walletBridge;
    }

    async request(args) {
        const { method, params = [] } = args;

        if (method === 'eth_requestAccounts') {
            return await this.bridge.requestAccounts();
        }

        return await this.bridge.request(method, params);
    }

    async send(method, params) {
        return await this.request({ method, params });
    }

    on(event, callback) {
        this.bridge.on(event, callback);
    }

    removeListener(event, callback) {
        this.bridge.removeListener(event, callback);
    }
}

export default EthersProvider;
