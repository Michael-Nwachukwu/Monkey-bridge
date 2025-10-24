import { ethers } from "hardhat";
import { parseUnits, formatUnits } from "ethers";

// This script automatically calculates the correct ratio from the existing pool

async function main() {
  console.log("🚀 Adding ETH/PYUSD liquidity (auto-calculated ratio)...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const UNISWAP_V2_FACTORY = "0x7E0987E5b3a30e3f2828572Bb659A548460a3003";
  const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
  const PYUSD_ADDRESS = "0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9";
  const WETH_ADDRESS = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";

  const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)"
  ];

  const PAIR_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)"
  ];

  const ROUTER_ABI = [
    "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
    "function quote(uint amountA, uint reserveA, uint reserveB) external pure returns (uint amountB)"
  ];

  const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address owner) view returns (uint256)"
  ];

  const factory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, deployer);
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, deployer);
  const pyusd = new ethers.Contract(PYUSD_ADDRESS, ERC20_ABI, deployer);

  // Get pool address
  const pairAddress = await factory.getPair(WETH_ADDRESS, PYUSD_ADDRESS);
  if (pairAddress === ethers.ZeroAddress) {
    console.log("❌ ETH/PYUSD pool doesn't exist!");
    return;
  }

  console.log("Pool address:", pairAddress, "\n");

  // Get reserves
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, deployer);
  const reserves = await pair.getReserves();
  const token0 = await pair.token0();

  const isWethToken0 = token0.toLowerCase() === WETH_ADDRESS.toLowerCase();
  const wethReserve = isWethToken0 ? reserves[0] : reserves[1];
  const pyusdReserve = isWethToken0 ? reserves[1] : reserves[0];

  console.log("Current pool reserves:");
  console.log("  WETH:", formatUnits(wethReserve, 18));
  console.log("  PYUSD:", formatUnits(pyusdReserve, 6));
  console.log("");

  // Let's add 0.05 ETH and calculate exact PYUSD needed
  const ethToAdd = parseUnits("0.05", 18);

  // Use Uniswap's quote function to get exact amount
  const pyusdNeeded = await router.quote(ethToAdd, wethReserve, pyusdReserve);

  console.log("Liquidity to add:");
  console.log("  ETH:", formatUnits(ethToAdd, 18));
  console.log("  PYUSD needed:", formatUnits(pyusdNeeded, 6));
  console.log("");

  // Check balance
  const pyusdBalance = await pyusd.balanceOf(deployer.address);
  if (pyusdBalance < pyusdNeeded) {
    console.log("❌ Insufficient PYUSD balance!");
    console.log(`   Have: ${formatUnits(pyusdBalance, 6)}`);
    console.log(`   Need: ${formatUnits(pyusdNeeded, 6)}`);
    return;
  }

  // Approve PYUSD
  console.log("⏳ Approving PYUSD...");
  const approveTx = await pyusd.approve(UNISWAP_V2_ROUTER, pyusdNeeded);
  await approveTx.wait();
  console.log("✅ PYUSD approved\n");

  // Add liquidity with 2% slippage
  const minPyusd = (pyusdNeeded * BigInt(98)) / BigInt(100);
  const minEth = (ethToAdd * BigInt(98)) / BigInt(100);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  console.log("⏳ Adding liquidity to pool...");
  const tx = await router.addLiquidityETH(
    PYUSD_ADDRESS,
    pyusdNeeded,
    minPyusd,
    minEth,
    deployer.address,
    deadline,
    { value: ethToAdd }
  );

  console.log("⏳ Waiting for confirmation...");
  const receipt = await tx.wait();

  console.log("\n✅ Success!");
  console.log("Transaction:", receipt.hash);
  console.log("\n🎉 ETH/PYUSD pool now has more liquidity!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  });
