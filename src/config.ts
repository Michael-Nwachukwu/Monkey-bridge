// Configuration for CryptoPay Bridge Extension

// Network configuration interface
interface NetworkConfig {
  escrow: string;
  pyusd: string;
  chainId: number;
}

// Contract addresses configuration
interface ContractsConfig {
  mainnet: NetworkConfig;
  polygon: NetworkConfig;
  sepolia: NetworkConfig;
  mumbai: NetworkConfig;
  localhost: NetworkConfig;
}

// Contract addresses (update after deployment)
export const CONTRACTS: ContractsConfig = {
  // Ethereum Mainnet
  mainnet: {
    escrow: '0x...', // Update with deployed address
    pyusd: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8',
    chainId: 1
  },
  // Polygon Mainnet (recommended for lower fees)
  polygon: {
    escrow: '0x...', // Update with deployed address
    pyusd: '0x...', // Update with Polygon PYUSD address
    chainId: 137
  },
  // Sepolia Testnet
  sepolia: {
    escrow: '0x99035Fef25B54158d198BA9718090FebCbCE10B7', // Updated with swap-only functions
    pyusd: '0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9', // PYUSD on Sepolia
    chainId: 11155111
  },
  // Polygon Mumbai Testnet
  mumbai: {
    escrow: '0x...', // Update with deployed address
    pyusd: '0x...', // Mock PYUSD on testnet
    chainId: 80001
  },
  // Localhost (for development)
  localhost: {
    escrow: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0', // From deployment
    pyusd: '0x5FbDB2315678afecb367f032d93F642f64180aa3', // From deployment
    chainId: 31337
  }
};

// Escrow contract ABI (minimal - only functions we need)
export const ESCROW_ABI: string[] = [
  'function depositPayment(uint256 amount, string calldata orderId, string calldata merchantUrl) external returns (bytes32 paymentId)',
  'function releasePayment(bytes32 paymentId, address recipient) external',
  'function refundPayment(bytes32 paymentId) external',
  'function initiateRefund(bytes32 paymentId) external',
  'function approvePayment(bytes32 paymentId) external',
  'function raiseDispute(bytes32 paymentId) external',
  'function getPayment(bytes32 paymentId) external view returns (address user, uint256 amount, uint256 fee, uint256 depositTime, uint8 status, string memory orderId, string memory merchantUrl, bool requiresMultiSig, uint8 approvalCount)',
  'function getUserPayments(address user) external view returns (bytes32[] memory)',
  'function canRefund(bytes32 paymentId) external view returns (bool)',
  'function platformFeeBps() external view returns (uint256)',
  'function escrowTimeout() external view returns (uint256)',
  'event PaymentDeposited(bytes32 indexed paymentId, address indexed user, uint256 amount, uint256 fee, string orderId)',
  'event PaymentReleased(bytes32 indexed paymentId, address indexed backend, uint256 amount)',
  'event PaymentRefunded(bytes32 indexed paymentId, address indexed user, uint256 amount)'
];

// PYUSD Token ABI (minimal)
export const PYUSD_ABI: string[] = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

// Payment status enum (must match contract)
export const PaymentStatus: Record<string, number> = {
  Pending: 0,
  Processing: 1,
  Completed: 2,
  Refunded: 3,
  Disputed: 4
};

// API endpoints configuration
interface ApiEndpoints {
  analyzeCheckout: string;
  verifyPayment: string;
  executePayment: string;
  transactionStatus: string;
}

// API configuration interface
interface ApiConfig {
  baseUrl: string;
  endpoints: ApiEndpoints;
}

// Backend API configuration
export const API_CONFIG: ApiConfig = {
  baseUrl: process.env.NODE_ENV === 'production'
    ? 'https://your-backend.com'
    : 'http://localhost:3000',
  endpoints: {
    analyzeCheckout: '/api/analyze-checkout',
    verifyPayment: '/api/verify-crypto-payment',
    executePayment: '/api/execute-payment',
    transactionStatus: '/api/transaction-status'
  }
};

// Default settings interface
interface DefaultSettings {
  preferredNetwork: keyof ContractsConfig;
  useAI: boolean;
  maxSlippage: number;
  escrowTimeout: number;
  autoApprove: boolean;
}

// Default settings
export const DEFAULT_SETTINGS: DefaultSettings = {
  preferredNetwork: 'sepolia', // Sepolia testnet
  useAI: false,
  maxSlippage: 0.5, // 0.5%
  escrowTimeout: 3600, // 1 hour in seconds
  autoApprove: true // Auto-approve token spending
};

// Helper to get contract addresses for current network
export function getContractAddresses(chainId: number): NetworkConfig {
  const network = Object.entries(CONTRACTS).find(
    ([_, config]) => config.chainId === chainId
  );

  if (!network) {
    throw new Error(`Unsupported network: ${chainId}`);
  }

  return network[1];
}

// Helper to get network name from chain ID
export function getNetworkName(chainId: number): string {
  const network = Object.entries(CONTRACTS).find(
    ([_, config]) => config.chainId === chainId
  );

  return network ? network[0] : 'unknown';
}

// Supported chain IDs
export const SUPPORTED_CHAINS: number[] = Object.values(CONTRACTS).map(c => c.chainId);

// Gas estimation multipliers
interface GasMultipliers {
  deposit: number;
  release: number;
  refund: number;
}

export const GAS_MULTIPLIERS: GasMultipliers = {
  deposit: 1.2, // 20% buffer
  release: 1.1,
  refund: 1.1
};

export default {
  CONTRACTS,
  ESCROW_ABI,
  PYUSD_ABI,
  PaymentStatus,
  API_CONFIG,
  DEFAULT_SETTINGS,
  getContractAddresses,
  getNetworkName,
  SUPPORTED_CHAINS,
  GAS_MULTIPLIERS
};
