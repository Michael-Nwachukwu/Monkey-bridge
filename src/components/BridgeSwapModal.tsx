import React, { useState, useEffect } from 'react';
import NexusClient, { UnifiedBalance, BridgeParams } from '../NexusClient';
import { ethers } from 'ethers';
import { getContractAddresses } from '../config';

interface BridgeSwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  requiredPyusd: number;
  currentPyusd: number;
  userAddress: string;
  provider: any;
  onSuccess: () => void;
}

type TokenOption = 'USDC' | 'USDT' | 'ETH';

interface ChainBalance {
  chainId: number;
  chainName: string;
  balance: number;
}

const BridgeSwapModal: React.FC<BridgeSwapModalProps> = ({
  isOpen,
  onClose,
  requiredPyusd,
  currentPyusd,
  userAddress,
  provider,
  onSuccess
}) => {
  const [mode, setMode] = useState<'select' | 'bridge' | 'swap'>('select');
  const [selectedToken, setSelectedToken] = useState<TokenOption>('USDC');
  const [unifiedBalances, setUnifiedBalances] = useState<UnifiedBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [selectedChain, setSelectedChain] = useState<number>(0);
  const [bridgeAmount, setBridgeAmount] = useState<string>('');
  const [swapAmount, setSwapAmount] = useState<string>('');
  const [estimatedOutput, setEstimatedOutput] = useState<number>(0);

  const deficit = requiredPyusd - currentPyusd;

  // Supported chains (Sepolia is 11155111)
  const supportedChains = [
    { chainId: 84532, name: 'Base Sepolia' },
    { chainId: 80002, name: 'Polygon Amoy' },
    { chainId: 421614, name: 'Arbitrum Sepolia' },
    { chainId: 11155420, name: 'Optimism Sepolia' },
  ];

  useEffect(() => {
    if (isOpen) {
      fetchBalances();
    }
  }, [isOpen]);

  const fetchBalances = async () => {
    setLoading(true);
    try {
      const balances = await NexusClient.getUnifiedBalances();
      setUnifiedBalances(balances);
    } catch (err) {
      setError('Failed to fetch balances');
    } finally {
      setLoading(false);
    }
  };

  // Get balances for selected token across all chains
  const getTokenBalances = (token: TokenOption): ChainBalance[] => {
    return unifiedBalances
      .filter(b => b.token === token)
      .map(b => ({
        chainId: b.chainId,
        chainName: b.chainName,
        balance: b.balance
      }));
  };

  // Get total balance for a token across all non-Sepolia chains
  const getTotalBridgeable = (token: TokenOption): number => {
    return unifiedBalances
      .filter(b => b.token === token && b.chainId !== 11155111)
      .reduce((sum, b) => sum + b.balance, 0);
  };

  // Get balance on Sepolia for swapping
  const getSepoliaBalance = (token: TokenOption): number => {
    const sepoliaBal = unifiedBalances.find(
      b => b.token === token && b.chainId === 11155111
    );
    return sepoliaBal?.balance || 0;
  };

  const handleBridge = async () => {
    if (!selectedChain || !bridgeAmount) {
      setError('Please select a chain and enter amount');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const params: BridgeParams = {
        fromChainId: selectedChain,
        toChainId: 11155111, // Sepolia
        token: selectedToken,
        amount: parseFloat(bridgeAmount),
        recipient: userAddress
      };

      const result = await NexusClient.bridgeTokens(params);

      if (result.success) {
        // After bridging, automatically switch to swap mode
        setMode('swap');
        setSwapAmount(bridgeAmount);
      } else {
        setError('Bridge transaction failed');
      }
    } catch (err) {
      setError((err as Error).message || 'Bridge failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSwap = async () => {
    if (!swapAmount) {
      setError('Please enter swap amount');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Get contract address for current network (Sepolia = 11155111)
      const addresses = getContractAddresses(11155111);
      const contractAddress = addresses.escrow;
      const contractABI = [
        'function swapAndDepositUSDC(uint256 usdcAmount, string orderId, string merchantUrl) returns (bytes32)',
        'function swapAndDepositUSDT(uint256 usdtAmount, string orderId, string merchantUrl) returns (bytes32)',
        'function swapAndDepositETH(string orderId, string merchantUrl) payable returns (bytes32)',
        'function getSwapQuote(address tokenIn, uint256 amountIn) view returns (uint256)'
      ];

      const contract = new ethers.Contract(contractAddress, contractABI, provider.getSigner());

      // Determine which swap function to call
      let tx;
      const amount = ethers.parseUnits(swapAmount, selectedToken === 'ETH' ? 18 : 6);

      if (selectedToken === 'USDC') {
        // First approve USDC
        const usdcAddress = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
        const usdcContract = new ethers.Contract(
          usdcAddress,
          ['function approve(address spender, uint256 amount) returns (bool)'],
          provider.getSigner()
        );
        const approveTx = await usdcContract.approve(contractAddress, amount);
        await approveTx.wait();

        // Then swap and deposit
        tx = await contract.swapAndDepositUSDC(amount, 'temp-order-id', window.location.href);
      } else if (selectedToken === 'USDT') {
        // First approve USDT
        const usdtAddress = '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0';
        const usdtContract = new ethers.Contract(
          usdtAddress,
          ['function approve(address spender, uint256 amount) returns (bool)'],
          provider.getSigner()
        );
        const approveTx = await usdtContract.approve(contractAddress, amount);
        await approveTx.wait();

        // Then swap and deposit
        tx = await contract.swapAndDepositUSDT(amount, 'temp-order-id', window.location.href);
      } else {
        // ETH swap
        tx = await contract.swapAndDepositETH('temp-order-id', window.location.href, {
          value: amount
        });
      }

      await tx.wait();
      onSuccess();
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Swap failed');
    } finally {
      setLoading(false);
    }
  };

  const handleEstimateSwap = async () => {
    if (!swapAmount) return;

    try {
      const addresses = getContractAddresses(11155111);
      const contractAddress = addresses.escrow;
      const contractABI = [
        'function getSwapQuote(address tokenIn, uint256 amountIn) view returns (uint256)'
      ];

      const contract = new ethers.Contract(contractAddress, contractABI, provider);

      const tokenAddresses = {
        USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        USDT: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',
        ETH: '0x0000000000000000000000000000000000000000'
      };

      const amount = ethers.parseUnits(swapAmount, selectedToken === 'ETH' ? 18 : 6);
      const quote = await contract.getSwapQuote(tokenAddresses[selectedToken], amount);
      setEstimatedOutput(parseFloat(ethers.formatUnits(quote, 6)));
    } catch (err) {
      console.error('Failed to get quote:', err);
    }
  };

  useEffect(() => {
    if (swapAmount && mode === 'swap') {
      handleEstimateSwap();
    }
  }, [swapAmount, selectedToken, mode]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold" style={{ color: '#262f49' }}>
            Insufficient PYUSD
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Deficit Information */}
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-gray-600">You need</p>
          <p className="text-2xl font-bold" style={{ color: '#e1c800' }}>
            {deficit.toFixed(2)} PYUSD
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Current: {currentPyusd.toFixed(2)} / Required: {requiredPyusd.toFixed(2)}
          </p>
        </div>

        {/* Mode Selection */}
        {mode === 'select' && (
          <div>
            <p className="text-sm text-gray-600 mb-4">
              Choose how to get PYUSD:
            </p>

            {/* Token Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Token
              </label>
              <div className="flex gap-2">
                {(['USDC', 'USDT', 'ETH'] as TokenOption[]).map(token => (
                  <button
                    key={token}
                    onClick={() => setSelectedToken(token)}
                    className={`flex-1 py-2 px-4 rounded-lg border-2 transition ${
                      selectedToken === token
                        ? 'border-[#e1c800] bg-yellow-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {token}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#e1c800]"></div>
              </div>
            ) : (
              <>
                {/* Bridge Option */}
                <button
                  onClick={() => setMode('bridge')}
                  disabled={getTotalBridgeable(selectedToken) === 0}
                  className="w-full mb-3 p-4 rounded-lg border-2 border-gray-200 hover:border-[#e1c800] disabled:opacity-50 disabled:cursor-not-allowed text-left transition"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold" style={{ color: '#262f49' }}>
                        Bridge from other chains
                      </p>
                      <p className="text-sm text-gray-500">
                        Available: {getTotalBridgeable(selectedToken).toFixed(2)} {selectedToken}
                      </p>
                    </div>
                    <span className="text-2xl">→</span>
                  </div>
                </button>

                {/* Swap Option */}
                <button
                  onClick={() => setMode('swap')}
                  disabled={getSepoliaBalance(selectedToken) === 0}
                  className="w-full p-4 rounded-lg border-2 border-gray-200 hover:border-[#e1c800] disabled:opacity-50 disabled:cursor-not-allowed text-left transition"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold" style={{ color: '#262f49' }}>
                        Swap on Sepolia
                      </p>
                      <p className="text-sm text-gray-500">
                        Available: {getSepoliaBalance(selectedToken).toFixed(2)} {selectedToken}
                      </p>
                    </div>
                    <span className="text-2xl">🔄</span>
                  </div>
                </button>
              </>
            )}
          </div>
        )}

        {/* Bridge Mode */}
        {mode === 'bridge' && (
          <div>
            <button
              onClick={() => setMode('select')}
              className="mb-4 text-sm text-gray-600 hover:text-gray-800"
            >
              ← Back
            </button>

            <h3 className="font-semibold mb-3" style={{ color: '#262f49' }}>
              Bridge {selectedToken} to Sepolia
            </h3>

            {/* Chain Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                From Chain
              </label>
              <select
                value={selectedChain}
                onChange={(e) => setSelectedChain(Number(e.target.value))}
                className="w-full p-2 border rounded-lg"
              >
                <option value={0}>Select chain...</option>
                {getTokenBalances(selectedToken)
                  .filter(b => b.chainId !== 11155111)
                  .map(b => (
                    <option key={b.chainId} value={b.chainId}>
                      {b.chainName} ({b.balance.toFixed(2)} {selectedToken})
                    </option>
                  ))}
              </select>
            </div>

            {/* Amount Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amount
              </label>
              <input
                type="number"
                value={bridgeAmount}
                onChange={(e) => setBridgeAmount(e.target.value)}
                placeholder="0.00"
                className="w-full p-2 border rounded-lg"
                step="0.01"
                min="0"
              />
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <button
              onClick={handleBridge}
              disabled={loading || !selectedChain || !bridgeAmount}
              className="w-full py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#e1c800', color: '#262f49' }}
            >
              {loading ? 'Bridging...' : 'Bridge to Sepolia'}
            </button>
          </div>
        )}

        {/* Swap Mode */}
        {mode === 'swap' && (
          <div>
            <button
              onClick={() => setMode('select')}
              className="mb-4 text-sm text-gray-600 hover:text-gray-800"
            >
              ← Back
            </button>

            <h3 className="font-semibold mb-3" style={{ color: '#262f49' }}>
              Swap {selectedToken} to PYUSD
            </h3>

            <p className="text-sm text-gray-600 mb-4">
              Available: {getSepoliaBalance(selectedToken).toFixed(2)} {selectedToken}
            </p>

            {/* Amount Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amount to swap
              </label>
              <input
                type="number"
                value={swapAmount}
                onChange={(e) => setSwapAmount(e.target.value)}
                placeholder="0.00"
                className="w-full p-2 border rounded-lg"
                step="0.01"
                min="0"
                max={getSepoliaBalance(selectedToken)}
              />
            </div>

            {/* Estimated Output */}
            {estimatedOutput > 0 && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-gray-600">You will receive approximately:</p>
                <p className="text-lg font-bold text-green-700">
                  {estimatedOutput.toFixed(2)} PYUSD
                </p>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <button
              onClick={handleSwap}
              disabled={loading || !swapAmount}
              className="w-full py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#e1c800', color: '#262f49' }}
            >
              {loading ? 'Swapping...' : 'Swap to PYUSD'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BridgeSwapModal;
