import { ethers } from "hardhat";
import { parseUnits, formatUnits } from "ethers";

// Current ETH/PYUSD pool ratio: 1 ETH ≈ 6,513 PYUSD
// We'll add 0.1 ETH and let Uniswap calculate the exact PYUSD amount needed

async function main() {
  console.log("🚀 Adding ETH/PYUSD liquidity to existing pool...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
  const PYUSD_ADDRESS = "0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9";

  const ROUTER_ABI = [
    "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)"
  ];

  const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address owner) view returns (uint256)"
  ];

  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, deployer);
  const pyusd = new ethers.Contract(PYUSD_ADDRESS, ERC20_ABI, deployer);

  // Check balances
  const pyusdBalance = await pyusd.balanceOf(deployer.address);
  const ethBalance = await ethers.provider.getBalance(deployer.address);

  console.log("Your balances:");
  console.log("  PYUSD:", formatUnits(pyusdBalance, 6));
  console.log("  ETH:", formatUnits(ethBalance, 18));
  console.log("");

  // Pool ratio is 1 ETH : 6,513 PYUSD
  // Let's add 0.1 ETH + corresponding PYUSD
  const ethToAdd = parseUnits("0.1", 18);
  const pyusdToAdd = parseUnits("651.3", 6); // Matches ratio

  console.log("Adding liquidity:");
  console.log("  ETH:", formatUnits(ethToAdd, 18));
  console.log("  PYUSD:", formatUnits(pyusdToAdd, 6));
  console.log("");

  // Approve PYUSD
  console.log("⏳ Approving PYUSD...");
  const approveTx = await pyusd.approve(UNISWAP_V2_ROUTER, pyusdToAdd);
  await approveTx.wait();
  console.log("✅ PYUSD approved\n");

  // Add liquidity with 5% slippage tolerance
  const minPyusd = parseUnits("619", 6); // 651.3 * 0.95
  const minEth = parseUnits("0.095", 18); // 0.1 * 0.95
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  console.log("⏳ Adding liquidity to pool...");
  const tx = await router.addLiquidityETH(
    PYUSD_ADDRESS,
    pyusdToAdd,
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
  console.log("\n🎉 ETH/PYUSD pool now has more liquidity for swaps!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  });
