import './polyfills'; // MUST BE FIRST - Sets up Buffer and process globals
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ethers, Contract, BrowserProvider, Signer } from 'ethers';
import browser from 'webextension-polyfill';
import './index.css';
import {
    ESCROW_ABI,
    PYUSD_ABI,
    getContractAddresses,
    getNetworkName,
    PaymentStatus,
    SUPPORTED_CHAINS
} from './config';
import WalletBridge from './WalletBridge';
import EthersProvider from './EthersProvider';
import SwapModal from './components/SwapModal';
// Interfaces
interface CheckoutData {
    url?: string;
    amount: string;
    currency: string;
    merchantName: string;
    method?: string;
}

interface VirtualCard {
    cardNumber?: string;
    number?: string;
    expiry: string;
    cvv: string;
}

interface AutoFillStatus {
    success: boolean;
    message: string;
    filledFields?: {
        cardNumber: boolean;
        expiry: boolean;
        cvv: boolean;
    };
    reason?: string;
}

interface PaymentData {
    paymentId: string;
    escrowAddress: string;
    txHash: string;
    amount: number;
    currency: string;
    checkoutData: CheckoutData;
    orderId: string;
}

interface PaymentResult {
    success: boolean;
    virtualCard?: VirtualCard;
    error?: string;
}

type CurrentStep = 'idle' | 'analyzing' | 'approving' | 'depositing' | 'processing' | 'complete';

const Popup: React.FC = () => {
    const [provider, setProvider] = useState<BrowserProvider | null>(null);
    const [signer, setSigner] = useState<Signer | null>(null);
    const [account, setAccount] = useState<string>('');
    const [chainId, setChainId] = useState<number | null>(null);
    const [ethBalance, setEthBalance] = useState<string>('0');
    const [pyusdBalance, setPyusdBalance] = useState<string>('0');
    const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [txStatus, setTxStatus] = useState<string | null>(null);
    const [currentStep, setCurrentStep] = useState<CurrentStep>('idle');
    const [useAI, setUseAI] = useState<boolean>(false);
    const [paymentId, setPaymentId] = useState<string | null>(null);
    const [platformFee, setPlatformFee] = useState<number>(0);
    const [escrowAddress, setEscrowAddress] = useState<string>('');
    const [pyusdAddress, setPyusdAddress] = useState<string>('');
    const [walletBridge] = useState<WalletBridge>(() => new WalletBridge());
    const [virtualCard, setVirtualCard] = useState<VirtualCard | null>(null);
    const [autoFillStatus, setAutoFillStatus] = useState<AutoFillStatus | null>(null);
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [loadingBalances, setLoadingBalances] = useState<boolean>(false);
    const [requiredAmount, setRequiredAmount] = useState<number>(0);
    const [showSwapModal, setShowSwapModal] = useState<boolean>(false);

    useEffect(() => {
        checkConnection();
    }, []);

    const checkConnection = async (): Promise<void> => {
        try {
            console.log('🟣 [POPUP] Checking wallet availability...');
            const walletInfo = await walletBridge.checkWalletAvailable();
            console.log('🟣 [POPUP] Wallet info:', walletInfo);

            if (walletInfo.hasWallet) {
                // Check if already connected
                const ethersProvider = new EthersProvider(walletBridge);
                const accounts = await ethersProvider.request({
                    method: 'eth_accounts'
                });
                console.log('🟣 [POPUP] Existing accounts:', accounts);

                if (accounts && accounts.length > 0) {
                    await connectWallet();
                }
            }
        } catch (error) {
            console.error('🔴 [POPUP] Connection check failed:', error);
        }
    };

    const connectWallet = async (): Promise<void> => {
        setLoading(true);
        try {
            console.log('🟣 [POPUP] Starting wallet connection...');

            // Check if wallet is available
            const walletInfo = await walletBridge.checkWalletAvailable();
            console.log('🟣 [POPUP] Wallet availability:', walletInfo);

            if (!walletInfo.hasWallet) {
                const errorMsg = walletInfo.error || 'Please install MetaMask or Rabby wallet!';
                alert(errorMsg);
                setLoading(false);
                return;
            }

            // Create ethers provider
            const ethersProvider = new EthersProvider(walletBridge);
            const prov = new ethers.BrowserProvider(ethersProvider);
            setProvider(prov);

            console.log('🟣 [POPUP] Requesting accounts...');
            const accounts = await prov.send('eth_requestAccounts', []);
            console.log('🟣 [POPUP] Accounts received:', accounts);

            const userAccount = accounts[0];
            setAccount(userAccount);

            const network = await prov.getNetwork();
            const currentChainId = Number(network.chainId);
            setChainId(currentChainId);
            console.log('🟣 [POPUP] Network:', currentChainId);

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

            // Setup event listeners
            await walletBridge.setupEventListeners();
            walletBridge.on('accountsChanged', handleAccountsChanged);
            walletBridge.on('chainChanged', handleChainChanged);

            console.log('✅ [POPUP] Wallet connected successfully');

        } catch (err) {
            console.error('🔴 [POPUP] Wallet connection failed:', err);
            alert(`Failed to connect: ${(err as Error).message}`);
        } finally {
            setLoading(false);
        }
    };

    const loadPlatformFee = async (prov: BrowserProvider, escrowAddr: string): Promise<void> => {
        try {
            const escrow = new ethers.Contract(escrowAddr, ESCROW_ABI, prov);
            const feeBps = await escrow.platformFeeBps();
            setPlatformFee(Number(feeBps) / 100); // Convert bps to percentage
        } catch (error) {
            console.error('Failed to load platform fee:', error);
            setPlatformFee(1.5); // Default 1.5%
        }
    };

    const updateBalances = async (prov: BrowserProvider, userAccount: string, pyusdAddr: string): Promise<void> => {
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

    const handleAccountsChanged = (accounts: string[]): void => {
        if (accounts.length === 0) {
            disconnectWallet();
        } else {
            setAccount(accounts[0]);
            if (provider) {
                updateBalances(provider, accounts[0], pyusdAddress);
            }
        }
    };

    const handleChainChanged = (): void => {
        window.location.reload();
    };

    const disconnectWallet = (): void => {
        setIsConnected(false);
        setAccount('');
        setEthBalance('0');
        setPyusdBalance('0');
        setSigner(null);
        setProvider(null);
        setPaymentId(null);
    };

    const scanCheckout = async (): Promise<void> => {
        setLoading(true);
        setCurrentStep('analyzing');
        try {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

            if (!tab || !tab.id) {
                throw new Error('No active tab found');
            }

            const response = await chrome.runtime.sendMessage({
                action: 'analyzePage',
                tabId: tab.id,
                useAI: useAI
            });

            if (response && response.success) {
                setCheckoutData(response.data);
                setCurrentStep('idle');
            } else {
                alert(`Failed to analyze page: ${response?.error || 'Unknown error'}`);
                setCurrentStep('idle');
            }
        } catch (error) {
            console.error('Scan failed:', error);
            alert(`Scan failed: ${(error as Error).message}`);
            setCurrentStep('idle');
        } finally {
            setLoading(false);
        }
    };

    const processPayment = async (): Promise<void> => {
        if (!checkoutData || !signer) {
            alert('Missing required data.');
            return;
        }

        const amountInPyusd = parseFloat(checkoutData.amount);
        const feeAmount = (amountInPyusd * platformFee) / 100;
        const totalAmount = amountInPyusd + feeAmount;

        if (parseFloat(pyusdBalance) < totalAmount) {
            // Show swap modal to swap tokens for PYUSD
            setRequiredAmount(totalAmount);
            setShowSwapModal(true);
            return;
        }

        setLoading(true);
        setCurrentStep('approving');

        try {
            const pyusdContract = new ethers.Contract(pyusdAddress, PYUSD_ABI, signer);
            const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

            // Step 1: Approve escrow contract to spend PYUSD
            setTxStatus('Approving PYUSD spend...');
            // Fix: Round to 6 decimals to avoid precision errors with PYUSD
            const totalAmountFixed = parseFloat(totalAmount.toFixed(6));
            const amountInUnits = ethers.parseUnits(totalAmountFixed.toString(), 6);

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
            // Fix: Round to 6 decimals to avoid precision errors
            const amountInPyusdFixed = parseFloat(amountInPyusd.toFixed(6));
            const amountOnly = ethers.parseUnits(amountInPyusdFixed.toString(), 6);

            const depositTx = await escrowContract.depositPayment(
                amountOnly,
                orderId,
                merchantUrl
            );

            setTxStatus('Waiting for deposit confirmation...');
            const depositReceipt = await depositTx.wait();

            // Extract payment ID from event
            const depositEvent = depositReceipt.logs
                .map((log: any) => {
                    try {
                        return escrowContract.interface.parseLog(log);
                    } catch {
                        return null;
                    }
                })
                .find((event: any) => event && event.name === 'PaymentDeposited');

            if (!depositEvent) {
                throw new Error('Payment ID not found in transaction');
            }

            const newPaymentId = depositEvent.args.paymentId;
            setPaymentId(newPaymentId);

            setTxStatus('Deposit confirmed! Processing payment...');
            setCurrentStep('processing');

            // Step 3: Notify backend to process payment
            const paymentResult: PaymentResult = await chrome.runtime.sendMessage({
                action: 'processCryptoPayment',
                paymentData: {
                    paymentId: newPaymentId,
                    escrowAddress: escrowAddress,
                    txHash: depositReceipt.hash,
                    amount: amountInPyusd,
                    currency: checkoutData.currency,
                    checkoutData: checkoutData,
                    orderId: orderId
                } as PaymentData
            });

            if (paymentResult.success) {
                setCurrentStep('complete');
                setTxStatus('Payment successful!');

                // Save virtual card to state
                if (paymentResult.virtualCard) {
                    setVirtualCard(paymentResult.virtualCard);

                    // Step 4: Try to fill payment form with virtual card
                    try {
                        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                        if (tab && tab.id) {
                            const fillResult = await chrome.tabs.sendMessage(tab.id, {
                                action: 'fillPaymentForm',
                                virtualCard: paymentResult.virtualCard
                            });

                            if (fillResult && fillResult.success) {
                                setAutoFillStatus({
                                    success: true,
                                    message: 'Payment form auto-filled successfully!',
                                    filledFields: fillResult.filledFields
                                });
                            } else {
                                setAutoFillStatus({
                                    success: false,
                                    message: 'Could not auto-fill form. Please copy card details manually.',
                                    reason: 'Payment fields not found or in iframe'
                                });
                            }
                        }
                    } catch (tabError) {
                        console.warn('Could not fill payment form:', tabError);
                        setAutoFillStatus({
                            success: false,
                            message: 'Could not auto-fill form. Please copy card details manually.',
                            reason: (tabError as Error).message
                        });
                    }
                }

                // Update balance
                if (provider) {
                    await updateBalances(provider, account, pyusdAddress);
                }

                alert('Payment completed successfully! Virtual card details are displayed below.');
            } else {
                throw new Error(paymentResult.error || 'Backend payment failed');
            }

        } catch (error) {
            console.error('Payment failed:', error);
            alert(`Payment failed: ${(error as Error).message}`);
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

    const refundPayment = async (): Promise<void> => {
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
            if (provider) {
                await updateBalances(provider, account, pyusdAddress);
            }

            alert('Refund completed successfully!');
        } catch (error) {
            console.error('Refund failed:', error);
            alert(`Refund failed: ${(error as Error).message}`);
        } finally {
            setLoading(false);
            setTxStatus(null);
        }
    };

    const formatAddress = (addr: string): string => {
        if (!addr) return '';
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    };

    const calculateTotal = (): { amount: number; fee: number; total: number } => {
        if (!checkoutData) return { amount: 0, fee: 0, total: 0 };
        const amount = parseFloat(checkoutData.amount);
        const fee = (amount * platformFee) / 100;
        return { amount, fee, total: amount + fee };
    };

    const copyToClipboard = async (text: string, fieldName: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(fieldName);
            setTimeout(() => setCopiedField(null), 2000);
        } catch (error) {
            console.error('Copy failed:', error);
            alert('Failed to copy to clipboard');
        }
    };

    const handleSwapSuccess = async (): Promise<void> => {
        // Close modal
        setShowSwapModal(false);

        // Update PYUSD balance
        if (provider && account) {
            await updateBalances(provider, account, pyusdAddress);
        }

        // Automatically retry payment after successful swap
        if (checkoutData) {
            await processPayment();
        }
    };

    return (
        <div className="w-full min-h-screen flex flex-col" style={{ backgroundColor: '#262f49' }}>
            {/* Wallet Connection Screen */}
            {!isConnected ? (
                <div
                    className="relative flex flex-col items-center justify-end min-h-screen p-3"
                    style={{
                        backgroundImage: 'url(/ooga.svg)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat'
                    }}
                >
                    {/* Overlay for better text readability */}
                    <div className="absolute inset-0 bg-black/50 top-0 w-full h-full"></div>

                    {/* Content */}
                    <div className="relative z-10 w-full space-y-6 mb-12">
                        <div className="text-center mb-8">
                            <h1 className="text-3xl font-bold text-white mb-2">Monkey Bridge</h1>
                            <p className="text-white text-opacity-90 text-sm">
                                Pay with crypto on any website
                            </p>
                            <p className="text-white text-opacity-75 text-xs mt-1">
                                Escrow Protected • Secure • Fast
                            </p>
                        </div>

                        <button
                            onClick={connectWallet}
                            disabled={loading}
                            className="w-full px-6 py-3 rounded-2xl font-semibold text-lg transition-all disabled:opacity-50 shadow-lg hover:shadow-xl transform hover:scale-105"
                            style={{
                                backgroundColor: '#e1c800',
                                color: '#262f49'
                            }}
                        >
                            {loading ? 'Connecting...' : 'Connect Wallet'}
                        </button>

                        <p className="text-white text-opacity-60 text-xs text-center">
                            Connect your wallet to start making payments with PYUSD
                        </p>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col min-h-screen">
                    {/* Header */}
                    <div className="flex justify-between items-center mb-6 border-b border-[#e1c800] p-3">
                        <div className="px-3 py-1 rounded-2xl border border-[#e1c800]/70 bg-[#e1c800]/30">
                            <p className="font-mono text-white text-xs">{formatAddress(account)}</p>
                        </div>
                        <button
                            onClick={disconnectWallet}
                            className="text-xs px-3 py-1 rounded-2xl font-medium transition-colors bg-red-800 text-white"
                        >
                            Disconnect
                        </button>
                    </div>

                    {/* PYUSD Balance - Center & Large */}
                    <div className="flex justify-center mt-10 p-3">
                        <div className="border-[#e1c800]/70 bg-[#e1c800]/20 border backdrop-blur-lg rounded-lg w-full h-32 flex flex-col items-center justify-center gap-4">
                            <div className="inline-flex items-center gap-2">
                                <img src="/pyusd.png" alt="PYUSD" className="w-8 h-8" />
                                <p className="text-white text-3xl font-semibold">PYUSD</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="bg-[#e1c800] py-1 px-3 rounded-xl text-black">
                                    <p className="text-opacity-60 text-xs">
                                        PYUSD: {parseFloat(pyusdBalance).toFixed(2)}
                                    </p>
                                </div>
                                <div className="bg-[#e1c800] py-1 px-3 rounded-xl text-black">
                                    <p className="text-opacity-60 text-xs">
                                        ETH: {parseFloat(ethBalance).toFixed(4)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>


                    {/* Scan Button */}
                    <div className="mt-auto p-3">
                        {!checkoutData && (
                            <>
                                <div className="bg-[#262f49] text-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 mb-4">
                                    <label className="flex items-center justify-between cursor-pointer">
                                        <span className="text-sm font-medium text-white">Use AI for page analysis</span>
                                        <input
                                            type="checkbox"
                                            checked={useAI}
                                            onChange={(e) => setUseAI(e.target.checked)}
                                            className="w-10 h-6"
                                        />
                                    </label>
                                    <p className="text-xs text-white text-opacity-60 mt-2">
                                        AI provides better accuracy but may be slower
                                    </p>
                                </div>

                                <button
                                    onClick={scanCheckout}
                                    disabled={loading}
                                    className="w-full px-6 py-3 rounded-2xl font-semibold text-lg transition-all disabled:opacity-50 shadow-lg mb-4"
                                    style={{
                                        backgroundColor: '#e1c800',
                                        color: '#262f49'
                                    }}
                                >
                                    {currentStep === 'analyzing' ? 'Analyzing Page...' : 'Scan Checkout Page'}
                                </button>
                            </>
                        )}
                    </div>

                    {/* Checkout Data */}
                    {checkoutData && (
                        <div className="mb-4 text-black p-3">
                            <h3 className="font-semibold mb-3 text-white text-sm">Checkout Summary</h3>
                            <div className="space-y-2 mb-4">
                                <div className="flex justify-between bg-gray-300 text-black bg-opacity-10 backdrop-blur-sm rounded-xl p-3">
                                    <span className="text-opacity-60">Merchant:</span>
                                    <span className="font-medium">{checkoutData.merchantName}</span>
                                </div>

                                <div className="bg-gray-300 text-black bg-opacity-10 backdrop-blur-sm rounded-xl p-3 space-y-3">
                                    <div className="flex justify-between">
                                        <span className=" text-opacity-60">Amount:</span>
                                        <span className="font-semibold ">
                                            ${calculateTotal().amount.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className=" text-opacity-60">Platform Fee ({platformFee}%):</span>
                                        <span className=" text-opacity-80">
                                            ${calculateTotal().fee.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="border-t border-[#262f49] border-opacity-20 pt-2 flex justify-between">
                                        <span className="font-semibold ">Total in PYUSD:</span>
                                        <span className="font-bold text-lg text-amber-800">
                                            ${calculateTotal().total.toFixed(2)}
                                        </span>
                                    </div>
                                    {
                                        virtualCard && <p>hello im gone</p>
                                    }
                                </div>
                                <div className="flex justify-between text-sm mt-2 text-white">
                                    <span className="text-opacity-50">Detected by:</span>
                                    <span className="text-opacity-70">{checkoutData.method || 'script'}</span>
                                </div>
                            </div>

                            {/* Payment ID & Refund Option */}
                            {paymentId && currentStep !== 'complete' && (
                                <div className="bg-white text-black bg-opacity-10 backdrop-blur-sm rounded-lg p-4 mb-4 border border-opacity-30" style={{ borderColor: '#e1c800' }}>
                                    <p className="text-xs font-semibold mb-2 text-amber-500">Payment ID:</p>
                                    <p className="text-xs text-amber-700 font-mono break-all mb-3">{paymentId}</p>
                                    <button
                                        onClick={refundPayment}
                                        disabled={loading}
                                        className="w-full px-3 py-2 rounded-lg text-sm transition-all disabled:opacity-50 border"
                                        style={{
                                            backgroundColor: 'transparent',
                                            color: '#e1c800',
                                            borderColor: '#e1c800'
                                        }}
                                    >
                                        Request Refund
                                    </button>
                                    <p className="text-xs text-amber-900 text-opacity-60 mt-2">
                                        Refund available after timeout period (if payment not processed)
                                    </p>
                                </div>
                            )}

                            {/* Virtual Card Display */}
                            {virtualCard && currentStep === 'complete' && (
                                <div className="bg-gray-300 bg-opacity-10 backdrop-blur-sm rounded-lg p-4 mb-4 border border-opacity-30">
                                    <h3 className="text-lg font-semibold mb-3 text-black">💳 Virtual Card Details</h3>

                                    {/* Auto-fill Status Notification */}
                                    {autoFillStatus && (
                                        <div className={`mb-3 p-3 rounded-lg ${autoFillStatus.success ? 'bg-green-900 bg-opacity-30 border border-green-500 border-opacity-50' : 'bg-yellow-900 bg-opacity-30 border border-yellow-500 border-opacity-50'}`}>
                                            <p className={`text-sm font-medium ${autoFillStatus.success ? 'text-green-300' : 'text-yellow-300'}`}>
                                                {autoFillStatus.success ? '✅' : '⚠️'} {autoFillStatus.message}
                                            </p>
                                            {autoFillStatus.success && autoFillStatus.filledFields && (
                                                <p className="text-xs text-green-400 mt-1">
                                                    Filled: {Object.entries(autoFillStatus.filledFields).filter(([_, v]) => v).map(([k]) => k).join(', ')}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    <div className="bg-[#262f49] bg-opacity-5 p-4 rounded-lg space-y-3">
                                        {/* Card Number with Copy Button */}
                                        <div>
                                            <div className="flex justify-between items-center mb-1">
                                                <p className="text-xs text-white text-opacity-60">Card Number</p>
                                                <button
                                                    onClick={() => copyToClipboard(virtualCard.cardNumber || virtualCard.number || '', 'cardNumber')}
                                                    className="text-xs px-2 py-1 rounded transition-all"
                                                    style={{
                                                        backgroundColor: '#e1c800',
                                                        color: '#262f49'
                                                    }}
                                                >
                                                    {copiedField === 'cardNumber' ? '✓ Copied!' : 'Copy'}
                                                </button>
                                            </div>
                                            <p className="font-mono font-semibold text-lg text-gray-400">{virtualCard.cardNumber || virtualCard.number}</p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            {/* Expiry with Copy Button */}
                                            <div>
                                                <div className="flex justify-between items-center mb-1">
                                                    <p className="text-xs text-white text-opacity-60">Expiry</p>
                                                    <button
                                                        onClick={() => copyToClipboard(virtualCard.expiry, 'expiry')}
                                                        className="text-xs px-2 py-1 rounded transition-all"
                                                        style={{
                                                            backgroundColor: '#e1c800',
                                                            color: '#262f49'
                                                        }}
                                                    >
                                                        {copiedField === 'expiry' ? '✓' : 'Copy'}
                                                    </button>
                                                </div>
                                                <p className="font-mono font-semibold text-gray-400">{virtualCard.expiry}</p>
                                            </div>

                                            {/* CVV with Copy Button */}
                                            <div>
                                                <div className="flex justify-between items-center mb-1">
                                                    <p className="text-xs text-white text-opacity-60">CVV</p>
                                                    <button
                                                        onClick={() => copyToClipboard(virtualCard.cvv, 'cvv')}
                                                        className="text-xs px-2 py-1 rounded transition-all"
                                                        style={{
                                                            backgroundColor: '#e1c800',
                                                            color: '#262f49'
                                                        }}
                                                    >
                                                        {copiedField === 'cvv' ? '✓' : 'Copy'}
                                                    </button>
                                                </div>
                                                <p className="font-mono font-semibold text-gray-400">{virtualCard.cvv}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <p className="text-xs text-[#262f49] text-opacity-70 mt-3">
                                        {autoFillStatus?.success
                                            ? '✅ Form auto-filled! Verify and complete your purchase.'
                                            : '📋 Copy these details to complete your purchase on the merchant site.'}
                                    </p>
                                </div>
                            )}

                            {/* Transaction Status */}
                            {txStatus && (
                                <div className="bg-white bg-opacity-10 backdrop-blur-sm rounded-xl p-4 mb-4 border border-opacity-30" style={{ borderColor: '#e1c800' }}>
                                    <p className="text-sm text-black">{txStatus}</p>
                                </div>
                            )}

                            <div className="flex flex-col gap-3 mt-auto">
                                <button
                                    onClick={processPayment}
                                    disabled={loading}
                                    className="w-full px-4 py-3 rounded-lg font-medium transition-all disabled:opacity-50 mb-2 shadow-lg"
                                    style={{
                                        backgroundColor: '#e1c800',
                                        color: '#262f49'
                                    }}
                                >
                                    {currentStep === 'approving' && 'Approving...'}
                                    {currentStep === 'depositing' && 'Depositing to Escrow...'}
                                    {currentStep === 'processing' && 'Processing Payment...'}
                                    {currentStep === 'complete' && 'Payment Complete!'}
                                    {currentStep === 'idle' && `Pay ${calculateTotal().total.toFixed(2)} PYUSD (Escrow)`}
                                </button>

                                <button
                                    onClick={() => setCheckoutData(null)}
                                    className="w-full bg-neutral-700 border-2 shadow-2xl border-black bg-opacity-10 hover:bg-opacity-20 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                </div>
            )}

            {/* Escrow Info */}
            {isConnected && (
                <div className="bg-white bg-opacity-5 rounded-lg p-4 mt-auto mx-3 mb-3">
                    <p className="text-xs text-black text-opacity-50 mb-1">Escrow Contract:</p>
                    <p className="text-xs font-mono text-black text-opacity-70 break-all">{escrowAddress || 'Not configured'}</p>
                </div>
            )}

            {/* Swap Modal - For swapping tokens on Sepolia */}
            <SwapModal
                isOpen={showSwapModal}
                onClose={() => setShowSwapModal(false)}
                requiredPyusd={requiredAmount}
                currentPyusd={parseFloat(pyusdBalance)}
                userAddress={account}
                provider={provider}
                chainId={chainId || 11155111}
                onSuccess={handleSwapSuccess}
            />
        </div>
    );
};

// Mount React app
const root = createRoot(document.getElementById('root')!);
root.render(<Popup />);
