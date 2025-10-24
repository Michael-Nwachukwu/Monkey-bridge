import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { getContractAddresses } from '../config';

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  requiredPyusd: number;
  currentPyusd: number;
  userAddress: string;
  provider: any;
  chainId: number;
  onSuccess: () => void;
}

type TokenOption = 'USDC' | 'USDT' | 'ETH';

const SwapModal: React.FC<SwapModalProps> = ({
  isOpen,
  onClose,
  requiredPyusd,
  currentPyusd,
  userAddress,
  provider,
  chainId,
  onSuccess
}) => {
  const [selectedToken, setSelectedToken] = useState<TokenOption>('USDC');
  const [swapAmount, setSwapAmount] = useState<string>('');
  const [estimatedOutput, setEstimatedOutput] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [tokenBalances, setTokenBalances] = useState<Record<TokenOption, number>>({
    USDC: 0,
    USDT: 0,
    ETH: 0
  });

  const deficit = requiredPyusd - currentPyusd;

  const TOKEN_ADDRESSES = {
    USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    USDT: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',
    ETH: ethers.ZeroAddress
  };

  useEffect(() => {
    if (isOpen && provider && userAddress) {
      fetchBalances();
    }
  }, [isOpen, provider, userAddress]);

  useEffect(() => {
    if (swapAmount && !loading) {
      handleEstimateSwap();
    }
  }, [swapAmount, selectedToken]);

  const fetchBalances = async () => {
    try {
      const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

      // Get USDC balance
      const usdcContract = new ethers.Contract(TOKEN_ADDRESSES.USDC, ERC20_ABI, provider);
      const usdcBal = await usdcContract.balanceOf(userAddress);

      // Get USDT balance
      const usdtContract = new ethers.Contract(TOKEN_ADDRESSES.USDT, ERC20_ABI, provider);
      const usdtBal = await usdtContract.balanceOf(userAddress);

      // Get ETH balance
      const ethBal = await provider.getBalance(userAddress);

      setTokenBalances({
        USDC: parseFloat(ethers.formatUnits(usdcBal, 6)),
        USDT: parseFloat(ethers.formatUnits(usdtBal, 6)),
        ETH: parseFloat(ethers.formatEther(ethBal))
      });
    } catch (err) {
      console.error('Failed to fetch balances:', err);
    }
  };

  const handleEstimateSwap = async () => {
    if (!swapAmount || parseFloat(swapAmount) <= 0) {
      setEstimatedOutput(0);
      return;
    }

    try {
      const addresses = getContractAddresses(chainId);
      const contractABI = [
        'function getSwapQuote(address tokenIn, uint256 amountIn) view returns (uint256)'
      ];

      const contract = new ethers.Contract(addresses.escrow, contractABI, provider);
      const amount = ethers.parseUnits(swapAmount, selectedToken === 'ETH' ? 18 : 6);
      const quote = await contract.getSwapQuote(TOKEN_ADDRESSES[selectedToken], amount);
      setEstimatedOutput(parseFloat(ethers.formatUnits(quote, 6)));
      setError('');
    } catch (err) {
      console.error('Failed to get quote:', err);
      setEstimatedOutput(0);
      // Don't show error for quote failures
    }
  };

  const handleSwap = async () => {
    if (!swapAmount || parseFloat(swapAmount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    const swapAmountNum = parseFloat(swapAmount);
    if (swapAmountNum > tokenBalances[selectedToken]) {
      setError(`Insufficient ${selectedToken} balance`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const addresses = getContractAddresses(chainId);
      const signer = await provider.getSigner();

      // Use new swap-only functions that send PYUSD to user wallet
      const contractABI = [
        'function swapUSDCtoPYUSD(uint256 usdcAmount) returns (uint256)',
        'function swapUSDTtoPYUSD(uint256 usdtAmount) returns (uint256)',
        'function swapETHtoPYUSD() payable returns (uint256)'
      ];

      const contract = new ethers.Contract(addresses.escrow, contractABI, signer);

      let tx;
      const amount = ethers.parseUnits(swapAmount, selectedToken === 'ETH' ? 18 : 6);

      if (selectedToken === 'USDC') {
        // Approve USDC
        const usdcContract = new ethers.Contract(
          TOKEN_ADDRESSES.USDC,
          ['function approve(address spender, uint256 amount) returns (bool)'],
          signer
        );
        const approveTx = await usdcContract.approve(addresses.escrow, amount);
        await approveTx.wait();

        // Swap only - PYUSD goes to user wallet
        tx = await contract.swapUSDCtoPYUSD(amount);
      } else if (selectedToken === 'USDT') {
        // Approve USDT
        const usdtContract = new ethers.Contract(
          TOKEN_ADDRESSES.USDT,
          ['function approve(address spender, uint256 amount) returns (bool)'],
          signer
        );
        const approveTx = await usdtContract.approve(addresses.escrow, amount);
        await approveTx.wait();

        // Swap only - PYUSD goes to user wallet
        tx = await contract.swapUSDTtoPYUSD(amount);
      } else {
        // Swap ETH only - PYUSD goes to user wallet
        tx = await contract.swapETHtoPYUSD({
          value: amount
        });
      }

      await tx.wait();
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Swap failed:', err);
      setError(err.message || 'Swap transaction failed');
    } finally {
      setLoading(false);
    }
  };

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
            {deficit.toFixed(2)} more PYUSD
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Current: {currentPyusd.toFixed(2)} / Required: {requiredPyusd.toFixed(2)}
          </p>
        </div>

        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            💡 <strong>How it works:</strong> Swap your tokens to PYUSD. The PYUSD will be sent to your wallet, then you can retry the payment.
          </p>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Select token to swap to PYUSD:
        </p>

        {/* Token Selection */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Token to Swap
          </label>
          <div className="flex gap-2">
            {(['USDC', 'USDT', 'ETH'] as TokenOption[]).map(token => (
              <button
                key={token}
                onClick={() => setSelectedToken(token)}
                className={`flex-1 py-3 px-4 rounded-lg border-2 transition ${selectedToken === token
                    ? 'border-[#e1c800] bg-yellow-50'
                    : 'border-gray-200 hover:border-gray-300'
                  }`}
              >
                <div className="font-semibold">{token}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {tokenBalances[token].toFixed(token === 'ETH' ? 4 : 2)}
                </div>
              </button>
            ))}
          </div>
        </div>

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
            className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e1c800]"
            step="0.01"
            min="0"
            max={tokenBalances[selectedToken]}
          />
          <button
            onClick={() => setSwapAmount(tokenBalances[selectedToken].toString())}
            className="text-xs text-[#e1c800] mt-1 hover:underline"
          >
            Use max
          </button>
        </div>

        {/* Estimated Output */}
        {estimatedOutput > 0 && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-gray-600">You will receive approximately:</p>
            <p className="text-lg font-bold text-green-700">
              {estimatedOutput.toFixed(2)} PYUSD
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Rate: 1 {selectedToken} ≈ {(estimatedOutput / parseFloat(swapAmount || '1')).toFixed(2)} PYUSD
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
          disabled={loading || !swapAmount || parseFloat(swapAmount) <= 0}
          className="w-full py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ backgroundColor: '#e1c800', color: '#262f49' }}
        >
          {loading ? 'Swapping...' : `Swap ${selectedToken} for PYUSD`}
        </button>

        <p className="text-xs text-gray-500 text-center mt-4">
          ⚡ PYUSD will be sent to your wallet • Powered by Uniswap V2
        </p>
      </div>
    </div>
  );
};

export default SwapModal;
