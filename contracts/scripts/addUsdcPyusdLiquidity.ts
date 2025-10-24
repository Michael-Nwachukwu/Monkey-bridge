import { ethers } from "hardhat";
import { parseUnits, formatUnits } from "ethers";

// Create USDC/PYUSD pool with 1:1 ratio

async function main() {
  console.log("🚀 Creating USDC/PYUSD liquidity pool...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
  const PYUSD_ADDRESS = "0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9";
  const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

  const ROUTER_ABI = [
    "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)"
  ];

  const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address owner) view returns (uint256)"
  ];

  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, deployer);
  const pyusd = new ethers.Contract(PYUSD_ADDRESS, ERC20_ABI, deployer);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, deployer);

  // Check balances
  const pyusdBalance = await pyusd.balanceOf(deployer.address);
  const usdcBalance = await usdc.balanceOf(deployer.address);

  console.log("Your balances:");
  console.log("  PYUSD:", formatUnits(pyusdBalance, 6));
  console.log("  USDC:", formatUnits(usdcBalance, 6));
  console.log("");

  // Add equal amounts (1:1 ratio since both are stablecoins)
  // Use your available balance or specify amount
  const amount = parseUnits("50", 6); // 50 of each token

  if (pyusdBalance < amount || usdcBalance < amount) {
    console.log("❌ Insufficient balance!");
    console.log(`   Need at least ${formatUnits(amount, 6)} of both USDC and PYUSD`);
    return;
  }

  console.log("Adding liquidity (1:1 ratio):");
  console.log("  USDC:", formatUnits(amount, 6));
  console.log("  PYUSD:", formatUnits(amount, 6));
  console.log("");

  // Approve both tokens
  console.log("⏳ Approving USDC...");
  const usdcApproveTx = await usdc.approve(UNISWAP_V2_ROUTER, amount);
  await usdcApproveTx.wait();
  console.log("✅ USDC approved");

  console.log("⏳ Approving PYUSD...");
  const pyusdApproveTx = await pyusd.approve(UNISWAP_V2_ROUTER, amount);
  await pyusdApproveTx.wait();
  console.log("✅ PYUSD approved\n");

  // Add liquidity with 1% slippage tolerance
  const minAmount = parseUnits("49.5", 6); // 1% slippage
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  console.log("⏳ Creating pool and adding liquidity...");
  const tx = await router.addLiquidity(
    USDC_ADDRESS,
    PYUSD_ADDRESS,
    amount,
    amount,
    minAmount,
    minAmount,
    deployer.address,
    deadline
  );

  console.log("⏳ Waiting for confirmation...");
  const receipt = await tx.wait();

  console.log("\n✅ Success!");
  console.log("Transaction:", receipt.hash);
  console.log("\n🎉 USDC/PYUSD pool created and ready for swaps!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  });
