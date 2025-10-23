import React from 'react';
import { UnifiedBalance } from '../NexusClient';

interface UnifiedBalanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    balances: UnifiedBalance[];
    loading: boolean;
}

interface GroupedBalance {
    token: string;
    chains: {
        chainName: string;
        chainId: number;
        balance: number;
        decimals: number;
    }[];
    total: number;
}

const UnifiedBalanceModal: React.FC<UnifiedBalanceModalProps> = ({
    isOpen,
    onClose,
    balances,
    loading
}) => {
    if (!isOpen) return null;

    // Group balances by token
    const groupedBalances: GroupedBalance[] = Object.values(
        balances.reduce((acc, balance) => {
            if (!acc[balance.token]) {
                acc[balance.token] = {
                    token: balance.token,
                    chains: [],
                    total: 0
                };
            }
            acc[balance.token].chains.push({
                chainName: balance.chainName,
                chainId: balance.chainId,
                balance: balance.balance,
                decimals: balance.decimals
            });
            acc[balance.token].total += balance.balance;
            return acc;
        }, {} as Record<string, GroupedBalance>)
    );

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
                style={{ backgroundColor: '#262f49' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-6 border-b" style={{ borderColor: '#e1c800' }}>
                    <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold text-white">
                            Unified Balances Across All Chains
                        </h2>
                        <button
                            onClick={onClose}
                            className="text-white hover:text-opacity-80 transition-colors text-2xl font-bold w-8 h-8 flex items-center justify-center"
                        >
                            &times;
                        </button>
                    </div>
                    <p className="text-white text-opacity-60 text-sm mt-2">
                        Powered by Avail Nexus SDK
                    </p>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: '#e1c800' }}></div>
                            <p className="text-white text-opacity-60 mt-4">Loading balances...</p>
                        </div>
                    ) : balances.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-white text-opacity-60">No balances found</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {groupedBalances.map((group) => (
                                <div
                                    key={group.token}
                                    className="rounded-lg p-4 border"
                                    style={{
                                        backgroundColor: 'rgba(225, 200, 0, 0.1)',
                                        borderColor: '#e1c800'
                                    }}
                                >
                                    {/* Token Header */}
                                    <div className="flex justify-between items-center mb-4 pb-3 border-b" style={{ borderColor: '#e1c800' }}>
                                        <h3 className="text-xl font-bold text-white">
                                            {group.token}
                                        </h3>
                                        <div className="text-right">
                                            <p className="text-xs text-white text-opacity-60">Total Balance</p>
                                            <p className="text-2xl font-bold" style={{ color: '#e1c800' }}>
                                                {group.total.toFixed(6)}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Chain Balances */}
                                    <div className="space-y-2">
                                        {group.chains.map((chain, idx) => (
                                            <div
                                                key={`${chain.chainId}-${idx}`}
                                                className="flex justify-between items-center p-3 rounded-lg"
                                                style={{ backgroundColor: 'rgba(38, 47, 73, 0.3)' }}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div
                                                        className="w-2 h-2 rounded-full"
                                                        style={{ backgroundColor: '#e1c800' }}
                                                    ></div>
                                                    <div>
                                                        <p className="font-medium text-white">
                                                            {chain.chainName}
                                                        </p>
                                                        <p className="text-xs text-white text-opacity-50">
                                                            Chain ID: {chain.chainId}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-semibold text-white">
                                                        {chain.balance.toFixed(6)}
                                                    </p>
                                                    <p className="text-xs text-white text-opacity-50">
                                                        {group.token}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t" style={{ borderColor: '#e1c800' }}>
                    <button
                        onClick={onClose}
                        className="w-full px-6 py-3 rounded-lg font-semibold transition-all hover:opacity-90"
                        style={{
                            backgroundColor: '#e1c800',
                            color: '#262f49'
                        }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UnifiedBalanceModal;
