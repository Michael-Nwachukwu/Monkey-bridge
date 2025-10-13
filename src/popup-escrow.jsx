import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import './index.css';
import {
    ESCROW_ABI,
    PYUSD_ABI,
    getContractAddresses,
    getNetworkName,
    PaymentStatus,
    SUPPORTED_CHAINS
} from './config.js';

const Popup = () => {
    const [provider, setProvider] = useState(null);
    const [signer, setSigner] = useState(null);
    const [account, setAccount] = useState('');
    const [chainId, setChainId] = useState(null);
    const [ethBalance, setEthBalance] = useState('0');
    const [pyusdBalance, setPyusdBalance] = useState('0');
    const [checkoutData, setCheckoutData] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [loading, setLoading] = useState(false);
    const [txStatus, setTxStatus] = useState(null);
    const [currentStep, setCurrentStep] = useState('idle');
    const [useAI, setUseAI] = useState(false);
    const [paymentId, setPaymentId] = useState(null);
    const [platformFee, setPlatformFee] = useState(0);
    const [escrowAddress, setEscrowAddress] = useState('');
    const [pyusdAddress, setPyusdAddress] = useState('');

    useEffect(() => {
        checkConnection();
    }, []);

    const checkConnection = async () => {
        if (window.ethereum) {
            try {
                const accounts = await window.ethereum.request({
                    method: 'eth_accounts'
                });
                if (accounts.length > 0) {
                    await connectWallet();
                }
            } catch (error) {
                console.error('Connection check failed:', error);
            }
        }
    };

    const connectWallet = async () => {
        if (!window.ethereum) {
            alert('Please install MetaMask or Rabby wallet!');
            return;
        }

        setLoading(true);
        try {
            const prov = new ethers.BrowserProvider(window.ethereum);
            setProvider(prov);

            const accounts = await prov.send('eth_requestAccounts', []);
            const userAccount = accounts[0];
            setAccount(userAccount);

            const network = await prov.getNetwork();
            const currentChainId = Number(network.chainId);
            setChainId(currentChainId);

            // Check if network is supported
            if (!SUPPORTED_CHAINS.includes(currentChainId)) {
                alert(`Unsupported network. Please switch to: ${SUPPORTED_CHAINS.join(', ')}`);
                setLoading(false);
                return;
            }

            // Get contract addresses for this network
            const addresses = getContractAddresses(currentChainId);
            setEscrowAddress(addresses.escrow);
            setPyusdAddress(addresses.pyusd);

            const sign = await prov.getSigner();
            setSigner(sign);
            setIsConnected(true);

            // Get balances
            await updateBalances(prov, userAccount, addresses.pyusd);

            // Get platform fee
            await loadPlatformFee(prov, addresses.escrow);

            // Listen for account/chain changes
            window.ethereum.on('accountsChanged', handleAccountsChanged);
            window.ethereum.on('chainChanged', handleChainChanged);

        } catch (err) {
            console.error('Wallet connection failed:', err);
            alert(`Failed to connect: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const loadPlatformFee = async (prov, escrowAddr) => {
        try {
            const escrow = new ethers.Contract(escrowAddr, ESCROW_ABI, prov);
            const feeBps = await escrow.platformFeeBps();
            setPlatformFee(Number(feeBps) / 100); // Convert bps to percentage
        } catch (error) {
            console.error('Failed to load platform fee:', error);
            setPlatformFee(1.5); // Default 1.5%
        }
    };

    const updateBalances = async (prov, userAccount, pyusdAddr) => {
        try {
            // Get ETH balance
            const ethBal = await prov.getBalance(userAccount);
            setEthBalance(ethers.formatEther(ethBal));

            // Get PYUSD balance
            const pyusdContract = new ethers.Contract(pyusdAddr, PYUSD_ABI, prov);
            const pyusdBal = await pyusdContract.balanceOf(userAccount);
            setPyusdBalance(ethers.formatUnits(pyusdBal, 6));
        } catch (error) {
            console.error('Balance update failed:', error);
        }
    };

    const handleAccountsChanged = (accounts) => {
        if (accounts.length === 0) {
            disconnectWallet();
        } else {
            setAccount(accounts[0]);
            updateBalances(provider, accounts[0], pyusdAddress);
        }
    };

    const handleChainChanged = () => {
        window.location.reload();
    };

    const disconnectWallet = () => {
        setIsConnected(false);
        setAccount('');
        setEthBalance('0');
        setPyusdBalance('0');
        setSigner(null);
        setProvider(null);
        setPaymentId(null);
    };

    const scanCheckout = async () => {
        setLoading(true);
        setCurrentStep('analyzing');
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            const response = await chrome.runtime.sendMessage({
                action: 'analyzePage',
                tabId: tab.id,
                useAI: useAI
            });

            if (response.success) {
                setCheckoutData(response.data);
                setCurrentStep('idle');
            } else {
                alert(`Failed to analyze page: ${response.error}`);
                setCurrentStep('idle');
            }
        } catch (error) {
            console.error('Scan failed:', error);
            alert(`Scan failed: ${error.message}`);
            setCurrentStep('idle');
        } finally {
            setLoading(false);
        }
    };

    const processPayment = async () => {
        if (!checkoutData || !signer) {
            alert('Missing required data.');
            return;
        }

        const amountInPyusd = parseFloat(checkoutData.amount);
        const feeAmount = (amountInPyusd * platformFee) / 100;
        const totalAmount = amountInPyusd + feeAmount;

        if (parseFloat(pyusdBalance) < totalAmount) {
            alert(`Insufficient PYUSD balance. You need ${totalAmount.toFixed(2)} PYUSD (${amountInPyusd} + ${feeAmount.toFixed(2)} fee)`);
            return;
        }

        setLoading(true);
        setCurrentStep('approving');

        try {
            const pyusdContract = new ethers.Contract(pyusdAddress, PYUSD_ABI, signer);
            const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

            // Step 1: Approve escrow contract to spend PYUSD
            setTxStatus('Approving PYUSD spend...');
            const amountInUnits = ethers.parseUnits(totalAmount.toString(), 6);

            // Check current allowance
            const currentAllowance = await pyusdContract.allowance(account, escrowAddress);

            if (currentAllowance < amountInUnits) {
                const approveTx = await pyusdContract.approve(escrowAddress, amountInUnits);
                setTxStatus('Waiting for approval confirmation...');
                await approveTx.wait();
            }

            // Step 2: Deposit to escrow
            setCurrentStep('depositing');
            setTxStatus('Depositing PYUSD to escrow...');

            const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const merchantUrl = checkoutData.url || window.location.href;
            const amountOnly = ethers.parseUnits(amountInPyusd.toString(), 6);

            const depositTx = await escrowContract.depositPayment(
                amountOnly,
                orderId,
                merchantUrl
            );

            setTxStatus('Waiting for deposit confirmation...');
            const depositReceipt = await depositTx.wait();

            // Extract payment ID from event
            const depositEvent = depositReceipt.logs
                .map(log => {
                    try {
                        return escrowContract.interface.parseLog(log);
                    } catch {
                        return null;
                    }
                })
                .find(event => event && event.name === 'PaymentDeposited');

            if (!depositEvent) {
                throw new Error('Payment ID not found in transaction');
            }

            const newPaymentId = depositEvent.args.paymentId;
            setPaymentId(newPaymentId);

            setTxStatus('Deposit confirmed! Processing payment...');
            setCurrentStep('processing');

            // Step 3: Notify backend to process payment
            const paymentResult = await chrome.runtime.sendMessage({
                action: 'processCryptoPayment',
                paymentData: {
                    paymentId: newPaymentId,
                    escrowAddress: escrowAddress,
                    txHash: depositReceipt.hash,
                    amount: amountInPyusd,
                    currency: checkoutData.currency,
                    checkoutData: checkoutData,
                    orderId: orderId
                }
            });

            if (paymentResult.success) {
                setCurrentStep('complete');
                setTxStatus('Payment successful! Filling checkout form...');

                // Step 4: Fill payment form with virtual card
                if (paymentResult.virtualCard) {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'fillPaymentForm',
                        virtualCard: paymentResult.virtualCard
                    });
                }

                // Update balance
                await updateBalances(provider, account, pyusdAddress);

                alert('Payment completed successfully!');
            } else {
                throw new Error(paymentResult.error || 'Backend payment failed');
            }

        } catch (error) {
            console.error('Payment failed:', error);
            alert(`Payment failed: ${error.message}`);
            setCurrentStep('idle');
            setTxStatus(null);

            // If we have a payment ID, user can refund later
            if (paymentId) {
                alert('Payment deposited to escrow but processing failed. You can refund after timeout period.');
            }
        } finally {
            setLoading(false);
        }
    };

    const refundPayment = async () => {
        if (!paymentId || !signer) {
            alert('No payment to refund');
            return;
        }

        setLoading(true);
        try {
            const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

            // Check if refund is available
            const canRefund = await escrowContract.canRefund(paymentId);
            if (!canRefund) {
                alert('Refund not available yet. Please wait for timeout period.');
                setLoading(false);
                return;
            }

            setTxStatus('Initiating refund...');
            const refundTx = await escrowContract.refundPayment(paymentId);

            setTxStatus('Waiting for refund confirmation...');
            await refundTx.wait();

            setTxStatus('Refund successful!');
            setPaymentId(null);
            setCheckoutData(null);

            // Update balance
            await updateBalances(provider, account, pyusdAddress);

            alert('Refund completed successfully!');
        } catch (error) {
            console.error('Refund failed:', error);
            alert(`Refund failed: ${error.message}`);
        } finally {
            setLoading(false);
            setTxStatus(null);
        }
    };

    const formatAddress = (addr) => {
        if (!addr) return '';
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    };

    const calculateTotal = () => {
        if (!checkoutData) return { amount: 0, fee: 0, total: 0 };
        const amount = parseFloat(checkoutData.amount);
        const fee = (amount * platformFee) / 100;
        return { amount, fee, total: amount + fee };
    };

    return (
        <div className="w-96 min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-6 flex flex-col">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-800">CryptoPay Bridge</h1>
                <p className="text-sm text-gray-600">Pay with PYUSD anywhere (Escrow Protected)</p>
            </div>

            {/* Network Info */}
            {isConnected && chainId && (
                <div className="bg-blue-100 border border-blue-300 rounded-lg p-3 mb-4">
                    <p className="text-xs text-blue-800 font-medium">
                        Network: {getNetworkName(chainId)} ({chainId})
                    </p>
                    <p className="text-xs text-blue-600 mt-1">
                        Fee: {platformFee}%
                    </p>
                </div>
            )}

            {/* Wallet Connection */}
            {!isConnected ? (
                <div className="bg-white rounded-lg shadow-md p-6 mb-4">
                    <h2 className="text-lg font-semibold mb-4">Connect Your Wallet</h2>
                    <button
                        onClick={connectWallet}
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Connecting...' : 'Connect Wallet'}
                    </button>
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow-md p-6 mb-4">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <p className="text-sm text-gray-600">Connected Account</p>
                            <p className="font-mono font-semibold">{formatAddress(account)}</p>
                        </div>
                        <button
                            onClick={disconnectWallet}
                            className="text-xs text-red-600 hover:text-red-800"
                        >
                            Disconnect
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-3 rounded-lg">
                            <p className="text-xs text-gray-600 mb-1">ETH Balance</p>
                            <p className="font-semibold">{parseFloat(ethBalance).toFixed(4)}</p>
                        </div>
                        <div className="bg-green-50 p-3 rounded-lg">
                            <p className="text-xs text-gray-600 mb-1">PYUSD Balance</p>
                            <p className="font-semibold text-green-700">{parseFloat(pyusdBalance).toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* AI Toggle */}
            {isConnected && (
                <div className="bg-white rounded-lg shadow-md p-4 mb-4">
                    <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-sm font-medium">Use AI for page analysis</span>
                        <input
                            type="checkbox"
                            checked={useAI}
                            onChange={(e) => setUseAI(e.target.checked)}
                            className="w-10 h-6"
                        />
                    </label>
                    <p className="text-xs text-gray-500 mt-2">
                        AI provides better accuracy but may be slower
                    </p>
                </div>
            )}

            {/* Scan Button */}
            {isConnected && !checkoutData && (
                <button
                    onClick={scanCheckout}
                    disabled={loading}
                    className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-lg font-medium mb-4 transition-colors disabled:opacity-50"
                >
                    {currentStep === 'analyzing' ? 'Analyzing Page...' : 'Scan Checkout Page'}
                </button>
            )}

            {/* Checkout Data */}
            {checkoutData && (
                <div className="bg-white rounded-lg shadow-md p-6 mb-4">
                    <h3 className="font-semibold mb-3">Checkout Summary</h3>
                    <div className="space-y-2 mb-4">
                        <div className="flex justify-between">
                            <span className="text-gray-600">Merchant:</span>
                            <span className="font-medium">{checkoutData.merchantName}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-600">Amount:</span>
                            <span className="font-semibold">
                                ${calculateTotal().amount.toFixed(2)}
                            </span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Platform Fee ({platformFee}%):</span>
                            <span className="text-gray-700">
                                ${calculateTotal().fee.toFixed(2)}
                            </span>
                        </div>
                        <div className="border-t pt-2 flex justify-between">
                            <span className="font-semibold">Total in PYUSD:</span>
                            <span className="font-bold text-lg text-purple-600">
                                ${calculateTotal().total.toFixed(2)}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs mt-2">
                            <span className="text-gray-500">Detected by:</span>
                            <span className="text-blue-600">{checkoutData.method || 'script'}</span>
                        </div>
                    </div>

                    <button
                        onClick={processPayment}
                        disabled={loading}
                        className="w-full bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 mb-2"
                    >
                        {currentStep === 'approving' && 'Approving...'}
                        {currentStep === 'depositing' && 'Depositing to Escrow...'}
                        {currentStep === 'processing' && 'Processing Payment...'}
                        {currentStep === 'complete' && 'Payment Complete!'}
                        {currentStep === 'idle' && `Pay ${calculateTotal().total.toFixed(2)} PYUSD (Escrow)`}
                    </button>

                    <button
                        onClick={() => setCheckoutData(null)}
                        className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            )}

            {/* Payment ID & Refund Option */}
            {paymentId && currentStep !== 'complete' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <p className="text-xs text-yellow-800 font-semibold mb-2">Payment ID:</p>
                    <p className="text-xs text-yellow-700 font-mono break-all mb-3">{paymentId}</p>
                    <button
                        onClick={refundPayment}
                        disabled={loading}
                        className="w-full bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                        Request Refund
                    </button>
                    <p className="text-xs text-yellow-600 mt-2">
                        Refund available after timeout period (if payment not processed)
                    </p>
                </div>
            )}

            {/* Transaction Status */}
            {txStatus && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-blue-800">{txStatus}</p>
                </div>
            )}

            {/* Escrow Info */}
            {isConnected && (
                <div className="bg-white rounded-lg shadow-sm p-4 mt-auto">
                    <p className="text-xs text-gray-500 mb-1">Escrow Contract:</p>
                    <p className="text-xs font-mono text-gray-700 break-all">{escrowAddress || 'Not configured'}</p>
                </div>
            )}
        </div>
    );
};

export default Popup;
