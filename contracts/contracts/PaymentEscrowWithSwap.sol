// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// Uniswap V2 Router interface
interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts);

    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function getAmountsOut(
        uint amountIn,
        address[] calldata path
    ) external view returns (uint[] memory amounts);

    function WETH() external pure returns (address);
}

/**
 * @title PaymentEscrowWithSwap
 * @dev Enhanced escrow contract with Uniswap V2 swap integration
 * 
 * Features:
 * - Swap USDC/USDT/ETH to PYUSD before depositing
 * - Original escrow functionality preserved
 * - Supports both direct PYUSD deposits and swap-then-deposit
 */
contract PaymentEscrowWithSwap is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant BACKEND_ROLE = keccak256("BACKEND_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // Token addresses (Sepolia)
    IERC20 public immutable pyusdToken;
    IERC20 public immutable usdcToken;
    IERC20 public immutable usdtToken;
    address public immutable wethAddress;

    // Uniswap V2 Router (Sepolia)
    IUniswapV2Router02 public immutable uniswapRouter;

    // Platform fee (in basis points, 100 = 1%)
    uint256 public platformFeeBps = 100; // 1%
    uint256 public constant MAX_FEE_BPS = 500; // Max 5%

    // Escrow timeout
    uint256 public escrowTimeout = 1 hours;
    uint256 public constant MAX_TIMEOUT = 24 hours;

    // Accumulated platform fees
    uint256 public accumulatedFees;

    // Slippage tolerance (in basis points, 100 = 1%)
    uint256 public slippageTolerance = 50; // 0.5%

    enum PaymentStatus {
        Pending,
        Processing,
        Completed,
        Refunded,
        Disputed
    }

    struct Payment {
        address user;
        uint256 amount; // Amount in PYUSD
        uint256 fee;
        uint256 depositTime;
        PaymentStatus status;
        string orderId;
        string merchantUrl;
    }

    // Payments mapping
    mapping(bytes32 => Payment) public payments;
    mapping(address => bytes32[]) public userPayments;

    // Events
    event PaymentDeposited(
        bytes32 indexed paymentId,
        address indexed user,
        uint256 amount,
        uint256 fee,
        string orderId
    );

    event TokensSwapped(
        address indexed user,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut
    );

    event PaymentReleased(
        bytes32 indexed paymentId,
        address indexed backend,
        uint256 amount
    );

    event PaymentRefunded(
        bytes32 indexed paymentId,
        address indexed user,
        uint256 amount
    );

    constructor(
        address _pyusdToken,
        address _usdcToken,
        address _usdtToken,
        address _uniswapRouter,
        address _backendWallet
    ) {
        require(_pyusdToken != address(0), "Invalid PYUSD address");
        require(_usdcToken != address(0), "Invalid USDC address");
        require(_usdtToken != address(0), "Invalid USDT address");
        require(_uniswapRouter != address(0), "Invalid router address");
        require(_backendWallet != address(0), "Invalid backend wallet");

        pyusdToken = IERC20(_pyusdToken);
        usdcToken = IERC20(_usdcToken);
        usdtToken = IERC20(_usdtToken);
        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
        wethAddress = uniswapRouter.WETH();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(BACKEND_ROLE, _backendWallet);
    }

    /**
     * @dev Deposit PYUSD directly (original functionality)
     */
    function depositPayment(
        uint256 amount,
        string calldata orderId,
        string calldata merchantUrl
    ) external nonReentrant whenNotPaused returns (bytes32 paymentId) {
        require(amount > 0, "Amount must be > 0");

        // Calculate fee
        uint256 fee = (amount * platformFeeBps) / 10000;
        uint256 totalAmount = amount + fee;

        // Transfer PYUSD from user
        pyusdToken.safeTransferFrom(msg.sender, address(this), totalAmount);

        // Create payment
        paymentId = keccak256(abi.encodePacked(msg.sender, block.timestamp, orderId));

        payments[paymentId] = Payment({
            user: msg.sender,
            amount: amount,
            fee: fee,
            depositTime: block.timestamp,
            status: PaymentStatus.Pending,
            orderId: orderId,
            merchantUrl: merchantUrl
        });

        userPayments[msg.sender].push(paymentId);
        accumulatedFees += fee;

        emit PaymentDeposited(paymentId, msg.sender, amount, fee, orderId);
    }

    /**
     * @dev Swap USDC to PYUSD and deposit
     */
    function swapAndDepositUSDC(
        uint256 usdcAmount,
        string calldata orderId,
        string calldata merchantUrl
    ) external nonReentrant whenNotPaused returns (bytes32 paymentId) {
        require(usdcAmount > 0, "Amount must be > 0");

        // Transfer USDC from user
        usdcToken.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Approve router
        usdcToken.forceApprove(address(uniswapRouter), usdcAmount);

        // Swap USDC to PYUSD
        address[] memory path = new address[](2);
        path[0] = address(usdcToken);
        path[1] = address(pyusdToken);

        uint256 minPyusdOut = _calculateMinAmountOut(usdcAmount, path);
        
        uint[] memory amounts = uniswapRouter.swapExactTokensForTokens(
            usdcAmount,
            minPyusdOut,
            path,
            address(this),
            block.timestamp + 300
        );

        uint256 pyusdReceived = amounts[1];
        emit TokensSwapped(msg.sender, address(usdcToken), usdcAmount, pyusdReceived);

        // Calculate fee on PYUSD received
        uint256 fee = (pyusdReceived * platformFeeBps) / 10000;
        uint256 amount = pyusdReceived - fee;

        // Create payment
        paymentId = keccak256(abi.encodePacked(msg.sender, block.timestamp, orderId));

        payments[paymentId] = Payment({
            user: msg.sender,
            amount: amount,
            fee: fee,
            depositTime: block.timestamp,
            status: PaymentStatus.Pending,
            orderId: orderId,
            merchantUrl: merchantUrl
        });

        userPayments[msg.sender].push(paymentId);
        accumulatedFees += fee;

        emit PaymentDeposited(paymentId, msg.sender, amount, fee, orderId);
    }

    /**
     * @dev Swap USDT to PYUSD and deposit
     */
    function swapAndDepositUSDT(
        uint256 usdtAmount,
        string calldata orderId,
        string calldata merchantUrl
    ) external nonReentrant whenNotPaused returns (bytes32 paymentId) {
        require(usdtAmount > 0, "Amount must be > 0");

        // Transfer USDT from user
        usdtToken.safeTransferFrom(msg.sender, address(this), usdtAmount);

        // Approve router
        usdtToken.forceApprove(address(uniswapRouter), usdtAmount);

        // Swap USDT to PYUSD
        address[] memory path = new address[](2);
        path[0] = address(usdtToken);
        path[1] = address(pyusdToken);

        uint256 minPyusdOut = _calculateMinAmountOut(usdtAmount, path);
        
        uint[] memory amounts = uniswapRouter.swapExactTokensForTokens(
            usdtAmount,
            minPyusdOut,
            path,
            address(this),
            block.timestamp + 300
        );

        uint256 pyusdReceived = amounts[1];
        emit TokensSwapped(msg.sender, address(usdtToken), usdtAmount, pyusdReceived);

        // Calculate fee on PYUSD received
        uint256 fee = (pyusdReceived * platformFeeBps) / 10000;
        uint256 amount = pyusdReceived - fee;

        // Create payment
        paymentId = keccak256(abi.encodePacked(msg.sender, block.timestamp, orderId));

        payments[paymentId] = Payment({
            user: msg.sender,
            amount: amount,
            fee: fee,
            depositTime: block.timestamp,
            status: PaymentStatus.Pending,
            orderId: orderId,
            merchantUrl: merchantUrl
        });

        userPayments[msg.sender].push(paymentId);
        accumulatedFees += fee;

        emit PaymentDeposited(paymentId, msg.sender, amount, fee, orderId);
    }

    /**
     * @dev Swap ETH to PYUSD and deposit
     */
    function swapAndDepositETH(
        string calldata orderId,
        string calldata merchantUrl
    ) external payable nonReentrant whenNotPaused returns (bytes32 paymentId) {
        require(msg.value > 0, "ETH amount must be > 0");

        // Swap ETH to PYUSD
        address[] memory path = new address[](2);
        path[0] = wethAddress;
        path[1] = address(pyusdToken);

        uint256 minPyusdOut = _calculateMinAmountOut(msg.value, path);
        
        uint[] memory amounts = uniswapRouter.swapExactETHForTokens{value: msg.value}(
            minPyusdOut,
            path,
            address(this),
            block.timestamp + 300
        );

        uint256 pyusdReceived = amounts[1];
        emit TokensSwapped(msg.sender, wethAddress, msg.value, pyusdReceived);

        // Calculate fee on PYUSD received
        uint256 fee = (pyusdReceived * platformFeeBps) / 10000;
        uint256 amount = pyusdReceived - fee;

        // Create payment
        paymentId = keccak256(abi.encodePacked(msg.sender, block.timestamp, orderId));

        payments[paymentId] = Payment({
            user: msg.sender,
            amount: amount,
            fee: fee,
            depositTime: block.timestamp,
            status: PaymentStatus.Pending,
            orderId: orderId,
            merchantUrl: merchantUrl
        });

        userPayments[msg.sender].push(paymentId);
        accumulatedFees += fee;

        emit PaymentDeposited(paymentId, msg.sender, amount, fee, orderId);
    }

    // ========== SWAP-ONLY FUNCTIONS (Send PYUSD to user, not escrow) ==========

    /**
     * @dev Swap USDC to PYUSD and send to user's wallet
     * @notice Use this when you only need to swap without immediate payment
     * @param usdcAmount Amount of USDC to swap
     * @return pyusdReceived Amount of PYUSD received by the user
     */
    function swapUSDCtoPYUSD(
        uint256 usdcAmount
    ) external nonReentrant whenNotPaused returns (uint256 pyusdReceived) {
        require(usdcAmount > 0, "Amount must be > 0");

        // Transfer USDC from user
        usdcToken.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Approve router
        usdcToken.forceApprove(address(uniswapRouter), usdcAmount);

        // Swap USDC to PYUSD
        address[] memory path = new address[](2);
        path[0] = address(usdcToken);
        path[1] = address(pyusdToken);

        uint256 minPyusdOut = _calculateMinAmountOut(usdcAmount, path);

        uint[] memory amounts = uniswapRouter.swapExactTokensForTokens(
            usdcAmount,
            minPyusdOut,
            path,
            msg.sender, // Send PYUSD directly to user
            block.timestamp + 300
        );

        pyusdReceived = amounts[1];
        emit TokensSwapped(msg.sender, address(usdcToken), usdcAmount, pyusdReceived);
    }

    /**
     * @dev Swap USDT to PYUSD and send to user's wallet
     * @notice Use this when you only need to swap without immediate payment
     * @param usdtAmount Amount of USDT to swap
     * @return pyusdReceived Amount of PYUSD received by the user
     */
    function swapUSDTtoPYUSD(
        uint256 usdtAmount
    ) external nonReentrant whenNotPaused returns (uint256 pyusdReceived) {
        require(usdtAmount > 0, "Amount must be > 0");

        // Transfer USDT from user
        usdtToken.safeTransferFrom(msg.sender, address(this), usdtAmount);

        // Approve router
        usdtToken.forceApprove(address(uniswapRouter), usdtAmount);

        // Swap USDT to PYUSD
        address[] memory path = new address[](2);
        path[0] = address(usdtToken);
        path[1] = address(pyusdToken);

        uint256 minPyusdOut = _calculateMinAmountOut(usdtAmount, path);

        uint[] memory amounts = uniswapRouter.swapExactTokensForTokens(
            usdtAmount,
            minPyusdOut,
            path,
            msg.sender, // Send PYUSD directly to user
            block.timestamp + 300
        );

        pyusdReceived = amounts[1];
        emit TokensSwapped(msg.sender, address(usdtToken), usdtAmount, pyusdReceived);
    }

    /**
     * @dev Swap ETH to PYUSD and send to user's wallet
     * @notice Use this when you only need to swap without immediate payment
     * @return pyusdReceived Amount of PYUSD received by the user
     */
    function swapETHtoPYUSD() external payable nonReentrant whenNotPaused returns (uint256 pyusdReceived) {
        require(msg.value > 0, "ETH amount must be > 0");

        // Swap ETH to PYUSD
        address[] memory path = new address[](2);
        path[0] = wethAddress;
        path[1] = address(pyusdToken);

        uint256 minPyusdOut = _calculateMinAmountOut(msg.value, path);

        uint[] memory amounts = uniswapRouter.swapExactETHForTokens{value: msg.value}(
            minPyusdOut,
            path,
            msg.sender, // Send PYUSD directly to user
            block.timestamp + 300
        );

        pyusdReceived = amounts[1];
        emit TokensSwapped(msg.sender, wethAddress, msg.value, pyusdReceived);
    }

    /**
     * @dev Get quote for swap (view function)
     */
    function getSwapQuote(
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 pyusdOut) {
        address[] memory path = new address[](2);
        path[0] = tokenIn == address(0) ? wethAddress : tokenIn;
        path[1] = address(pyusdToken);

        uint[] memory amounts = uniswapRouter.getAmountsOut(amountIn, path);
        pyusdOut = amounts[1];
    }

    /**
     * @dev Calculate minimum amount out with slippage
     */
    function _calculateMinAmountOut(
        uint256 amountIn,
        address[] memory path
    ) internal view returns (uint256) {
        uint[] memory amounts = uniswapRouter.getAmountsOut(amountIn, path);
        uint256 expectedOut = amounts[amounts.length - 1];
        return (expectedOut * (10000 - slippageTolerance)) / 10000;
    }

    /**
     * @dev Release payment (backend only)
     */
    function releasePayment(
        bytes32 paymentId,
        address recipient
    ) external onlyRole(BACKEND_ROLE) nonReentrant {
        Payment storage payment = payments[paymentId];
        require(payment.status == PaymentStatus.Pending, "Payment not pending");
        require(recipient != address(0), "Invalid recipient");

        payment.status = PaymentStatus.Completed;

        // Transfer PYUSD to recipient (backend's hot wallet)
        pyusdToken.safeTransfer(recipient, payment.amount);

        emit PaymentReleased(paymentId, msg.sender, payment.amount);
    }

    /**
     * @dev Refund payment
     */
    function refundPayment(bytes32 paymentId) external nonReentrant {
        Payment storage payment = payments[paymentId];
        require(payment.user == msg.sender, "Not payment owner");
        require(payment.status == PaymentStatus.Pending, "Payment not pending");
        require(
            block.timestamp >= payment.depositTime + escrowTimeout,
            "Timeout not reached"
        );

        payment.status = PaymentStatus.Refunded;

        // Refund PYUSD to user (including fee)
        uint256 refundAmount = payment.amount + payment.fee;
        pyusdToken.safeTransfer(msg.sender, refundAmount);

        // Deduct fee from accumulated fees
        accumulatedFees -= payment.fee;

        emit PaymentRefunded(paymentId, msg.sender, refundAmount);
    }

    /**
     * @dev Get payment details
     */
    function getPayment(bytes32 paymentId) external view returns (
        address user,
        uint256 amount,
        uint256 fee,
        uint256 depositTime,
        PaymentStatus status,
        string memory orderId,
        string memory merchantUrl
    ) {
        Payment memory payment = payments[paymentId];
        return (
            payment.user,
            payment.amount,
            payment.fee,
            payment.depositTime,
            payment.status,
            payment.orderId,
            payment.merchantUrl
        );
    }

    /**
     * @dev Check if payment can be refunded
     */
    function canRefund(bytes32 paymentId) external view returns (bool) {
        Payment memory payment = payments[paymentId];
        return payment.status == PaymentStatus.Pending && 
               block.timestamp >= payment.depositTime + escrowTimeout;
    }

    /**
     * @dev Get user payments
     */
    function getUserPayments(address user) external view returns (bytes32[] memory) {
        return userPayments[user];
    }

    /**
     * @dev Update slippage tolerance (admin only)
     */
    function setSlippageTolerance(uint256 _slippageTolerance) external onlyRole(ADMIN_ROLE) {
        require(_slippageTolerance <= 1000, "Slippage too high"); // Max 10%
        slippageTolerance = _slippageTolerance;
    }

    /**
     * @dev Withdraw accumulated fees (admin only)
     */
    function withdrawFees(address to) external onlyRole(ADMIN_ROLE) {
        require(to != address(0), "Invalid address");
        require(accumulatedFees > 0, "No fees to withdraw");

        uint256 amount = accumulatedFees;
        accumulatedFees = 0;

        pyusdToken.safeTransfer(to, amount);
    }

    /**
     * @dev Emergency pause
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    receive() external payable {}
}
