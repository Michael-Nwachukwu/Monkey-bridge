// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PaymentEscrow
 * @dev Escrow contract for CryptoPay Bridge
 *
 * Features:
 * - Users deposit PYUSD for purchases
 * - Backend releases funds after confirming successful checkout
 * - Users can refund if payment fails
 * - Multi-signature for large transactions
 * - Emergency pause mechanism
 */
contract PaymentEscrow is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant BACKEND_ROLE = keccak256("BACKEND_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // PYUSD token address (Ethereum mainnet)
    IERC20 public immutable pyusdToken;

    // Platform fee (in basis points, 100 = 1%)
    uint256 public platformFeeBps = 150; // 1.5%
    uint256 public constant MAX_FEE_BPS = 500; // Max 5%

    // Escrow timeout (after which user can refund)
    uint256 public escrowTimeout = 1 hours;
    uint256 public constant MAX_TIMEOUT = 24 hours;

    // For multi-sig on large transactions
    uint256 public multiSigThreshold = 1000e6; // $1000 (PYUSD has 6 decimals)

    // Accumulated platform fees
    uint256 public accumulatedFees;

    enum PaymentStatus {
        Pending,      // User deposited, awaiting backend processing
        Processing,   // Backend is processing the payment
        Completed,    // Payment successful, funds released
        Refunded,     // Payment failed, user refunded
        Disputed      // Under dispute resolution
    }

    struct Payment {
        address user;
        uint256 amount;
        uint256 fee;
        uint256 depositTime;
        PaymentStatus status;
        string orderId;        // External order reference
        string merchantUrl;    // Website where payment is made
        bool requiresMultiSig;
        uint8 approvalCount;   // For multi-sig
        mapping(address => bool) hasApproved;
    }

    // Payment ID => Payment details
    mapping(bytes32 => Payment) public payments;

    // User => list of payment IDs
    mapping(address => bytes32[]) public userPayments;

    // Events
    event PaymentDeposited(
        bytes32 indexed paymentId,
        address indexed user,
        uint256 amount,
        uint256 fee,
        string orderId
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

    event PaymentDisputed(
        bytes32 indexed paymentId,
        address indexed initiator
    );

    event MultiSigApproval(
        bytes32 indexed paymentId,
        address indexed approver,
        uint8 approvalCount
    );

    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event TimeoutUpdated(uint256 oldTimeout, uint256 newTimeout);
    event FeesWithdrawn(address indexed to, uint256 amount);

    constructor(address _pyusdToken, address _backend) {
        require(_pyusdToken != address(0), "Invalid PYUSD address");
        require(_backend != address(0), "Invalid backend address");

        pyusdToken = IERC20(_pyusdToken);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(BACKEND_ROLE, _backend);
    }

    /**
     * @dev User deposits PYUSD for a purchase
     * @param amount Amount of PYUSD to deposit (6 decimals)
     * @param orderId External order ID for reference
     * @param merchantUrl Website where payment will be made
     * @return paymentId Unique payment identifier
     */
    function depositPayment(
        uint256 amount,
        string calldata orderId,
        string calldata merchantUrl
    ) external nonReentrant whenNotPaused returns (bytes32 paymentId) {
        require(amount > 0, "Amount must be > 0");
        require(bytes(orderId).length > 0, "Order ID required");

        // Calculate fee
        uint256 fee = (amount * platformFeeBps) / 10000;
        uint256 totalAmount = amount + fee;

        // Generate unique payment ID
        paymentId = keccak256(
            abi.encodePacked(
                msg.sender,
                orderId,
                block.timestamp,
                block.number
            )
        );

        require(payments[paymentId].user == address(0), "Payment ID collision");

        // Transfer PYUSD from user
        pyusdToken.safeTransferFrom(msg.sender, address(this), totalAmount);

        // Create payment record
        Payment storage payment = payments[paymentId];
        payment.user = msg.sender;
        payment.amount = amount;
        payment.fee = fee;
        payment.depositTime = block.timestamp;
        payment.status = PaymentStatus.Pending;
        payment.orderId = orderId;
        payment.merchantUrl = merchantUrl;
        payment.requiresMultiSig = amount >= multiSigThreshold;

        // Track user payments
        userPayments[msg.sender].push(paymentId);

        emit PaymentDeposited(paymentId, msg.sender, amount, fee, orderId);

        return paymentId;
    }

    /**
     * @dev Backend releases funds after successful checkout
     * @param paymentId Payment to release
     * @param recipient Address to receive the funds (backend hot wallet)
     */
    function releasePayment(bytes32 paymentId, address recipient)
        external
        nonReentrant
        onlyRole(BACKEND_ROLE)
    {
        Payment storage payment = payments[paymentId];
        require(payment.status == PaymentStatus.Pending || payment.status == PaymentStatus.Processing, "Invalid status");
        require(recipient != address(0), "Invalid recipient");

        // Check multi-sig if required
        if (payment.requiresMultiSig) {
            require(payment.approvalCount >= 2, "Multi-sig required");
        }

        // Update status
        payment.status = PaymentStatus.Completed;

        // Add fee to accumulated fees
        accumulatedFees += payment.fee;

        // Transfer amount (minus fee) to backend
        pyusdToken.safeTransfer(recipient, payment.amount);

        emit PaymentReleased(paymentId, msg.sender, payment.amount);
    }

    /**
     * @dev User refunds if payment fails or timeout expires
     * @param paymentId Payment to refund
     */
    function refundPayment(bytes32 paymentId) external nonReentrant {
        Payment storage payment = payments[paymentId];
        require(payment.user == msg.sender, "Not payment owner");
        require(
            payment.status == PaymentStatus.Pending ||
            payment.status == PaymentStatus.Processing,
            "Cannot refund"
        );

        // Check timeout has passed
        require(
            block.timestamp >= payment.depositTime + escrowTimeout,
            "Timeout not reached"
        );

        // Update status
        payment.status = PaymentStatus.Refunded;

        // Refund full amount including fee
        uint256 refundAmount = payment.amount + payment.fee;
        pyusdToken.safeTransfer(msg.sender, refundAmount);

        emit PaymentRefunded(paymentId, msg.sender, refundAmount);
    }

    /**
     * @dev Backend can initiate refund if checkout fails immediately
     * @param paymentId Payment to refund
     */
    function initiateRefund(bytes32 paymentId)
        external
        onlyRole(BACKEND_ROLE)
        nonReentrant
    {
        Payment storage payment = payments[paymentId];
        require(
            payment.status == PaymentStatus.Pending ||
            payment.status == PaymentStatus.Processing,
            "Cannot refund"
        );

        // Update status
        payment.status = PaymentStatus.Refunded;

        // Refund full amount including fee
        uint256 refundAmount = payment.amount + payment.fee;
        pyusdToken.safeTransfer(payment.user, refundAmount);

        emit PaymentRefunded(paymentId, payment.user, refundAmount);
    }

    /**
     * @dev Approve payment (for multi-sig on large transactions)
     * @param paymentId Payment to approve
     */
    function approvePayment(bytes32 paymentId)
        external
        onlyRole(BACKEND_ROLE)
    {
        Payment storage payment = payments[paymentId];
        require(payment.status == PaymentStatus.Pending, "Invalid status");
        require(payment.requiresMultiSig, "Multi-sig not required");
        require(!payment.hasApproved[msg.sender], "Already approved");

        payment.hasApproved[msg.sender] = true;
        payment.approvalCount++;

        if (payment.approvalCount == 1) {
            payment.status = PaymentStatus.Processing;
        }

        emit MultiSigApproval(paymentId, msg.sender, payment.approvalCount);
    }

    /**
     * @dev Raise a dispute (freezes payment for manual resolution)
     * @param paymentId Payment to dispute
     */
    function raiseDispute(bytes32 paymentId) external {
        Payment storage payment = payments[paymentId];
        require(
            msg.sender == payment.user || hasRole(BACKEND_ROLE, msg.sender),
            "Not authorized"
        );
        require(
            payment.status == PaymentStatus.Pending ||
            payment.status == PaymentStatus.Processing,
            "Cannot dispute"
        );

        payment.status = PaymentStatus.Disputed;

        emit PaymentDisputed(paymentId, msg.sender);
    }

    /**
     * @dev Admin resolves dispute
     * @param paymentId Payment in dispute
     * @param releaseToUser If true, refund to user; if false, release to backend
     * @param recipient Recipient address
     */
    function resolveDispute(
        bytes32 paymentId,
        bool releaseToUser,
        address recipient
    ) external onlyRole(ADMIN_ROLE) nonReentrant {
        Payment storage payment = payments[paymentId];
        require(payment.status == PaymentStatus.Disputed, "Not disputed");
        require(recipient != address(0), "Invalid recipient");

        if (releaseToUser) {
            payment.status = PaymentStatus.Refunded;
            uint256 refundAmount = payment.amount + payment.fee;
            pyusdToken.safeTransfer(payment.user, refundAmount);
            emit PaymentRefunded(paymentId, payment.user, refundAmount);
        } else {
            payment.status = PaymentStatus.Completed;
            accumulatedFees += payment.fee;
            pyusdToken.safeTransfer(recipient, payment.amount);
            emit PaymentReleased(paymentId, msg.sender, payment.amount);
        }
    }

    /**
     * @dev Withdraw accumulated platform fees
     * @param to Address to receive fees
     */
    function withdrawFees(address to)
        external
        onlyRole(ADMIN_ROLE)
        nonReentrant
    {
        require(to != address(0), "Invalid address");
        require(accumulatedFees > 0, "No fees to withdraw");

        uint256 amount = accumulatedFees;
        accumulatedFees = 0;

        pyusdToken.safeTransfer(to, amount);

        emit FeesWithdrawn(to, amount);
    }

    /**
     * @dev Update platform fee
     * @param newFeeBps New fee in basis points
     */
    function setPlatformFee(uint256 newFeeBps) external onlyRole(ADMIN_ROLE) {
        require(newFeeBps <= MAX_FEE_BPS, "Fee too high");
        uint256 oldFee = platformFeeBps;
        platformFeeBps = newFeeBps;
        emit FeeUpdated(oldFee, newFeeBps);
    }

    /**
     * @dev Update escrow timeout
     * @param newTimeout New timeout in seconds
     */
    function setEscrowTimeout(uint256 newTimeout) external onlyRole(ADMIN_ROLE) {
        require(newTimeout <= MAX_TIMEOUT, "Timeout too long");
        uint256 oldTimeout = escrowTimeout;
        escrowTimeout = newTimeout;
        emit TimeoutUpdated(oldTimeout, newTimeout);
    }

    /**
     * @dev Update multi-sig threshold
     * @param newThreshold New threshold amount
     */
    function setMultiSigThreshold(uint256 newThreshold) external onlyRole(ADMIN_ROLE) {
        multiSigThreshold = newThreshold;
    }

    /**
     * @dev Emergency pause
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev Get payment details
     * @param paymentId Payment ID
     */
    function getPayment(bytes32 paymentId)
        external
        view
        returns (
            address user,
            uint256 amount,
            uint256 fee,
            uint256 depositTime,
            PaymentStatus status,
            string memory orderId,
            string memory merchantUrl,
            bool requiresMultiSig,
            uint8 approvalCount
        )
    {
        Payment storage payment = payments[paymentId];
        return (
            payment.user,
            payment.amount,
            payment.fee,
            payment.depositTime,
            payment.status,
            payment.orderId,
            payment.merchantUrl,
            payment.requiresMultiSig,
            payment.approvalCount
        );
    }

    /**
     * @dev Get all payment IDs for a user
     * @param user User address
     */
    function getUserPayments(address user)
        external
        view
        returns (bytes32[] memory)
    {
        return userPayments[user];
    }

    /**
     * @dev Check if payment can be refunded
     * @param paymentId Payment ID
     */
    function canRefund(bytes32 paymentId) external view returns (bool) {
        Payment storage payment = payments[paymentId];

        if (payment.status != PaymentStatus.Pending && payment.status != PaymentStatus.Processing) {
            return false;
        }

        return block.timestamp >= payment.depositTime + escrowTimeout;
    }
}
