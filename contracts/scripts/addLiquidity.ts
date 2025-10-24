import { ethers } from "hardhat";
import { parseUnits, formatUnits } from "ethers";

// Uniswap V2 Router on Sepolia
const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";

// Token addresses on Sepolia
const PYUSD_ADDRESS = "0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9";
const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // Sepolia USDC
// const USDT_ADDRESS = "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0"; // Sepolia USDT
// const WETH_ADDRESS = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9"; // Sepolia WETH

// Uniswap V2 Router ABI (minimal)
const ROUTER_ABI = [
  "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)",
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)"
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

async function main() {
  console.log("🚀 Adding liquidity to Uniswap V2 on Sepolia...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("ETH balance:", formatUnits(balance, 18), "ETH\n");

  // Initialize contracts
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, deployer);
  const pyusd = new ethers.Contract(PYUSD_ADDRESS, ERC20_ABI, deployer);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, deployer);
  // const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, deployer);

  // Check balances
  const pyusdBalance = await pyusd.balanceOf(deployer.address);
  const usdcBalance = await usdc.balanceOf(deployer.address);
  // const usdtBalance = await usdt.balanceOf(deployer.address);

  console.log("Token Balances:");
  console.log("  PYUSD:", formatUnits(pyusdBalance, 6));
  console.log("  USDC:", formatUnits(usdcBalance, 6));
  // console.log("  USDT:", formatUnits(usdtBalance, 6));
  console.log("");

  // Liquidity amounts (adjust based on your needs)
  const pyusdAmount = parseUnits("500", 6); // 1000 PYUSD
  // const usdcAmount = parseUnits("500", 6);  // 1000 USDC (1:1 ratio)
  // const usdtAmount = parseUnits("1000", 6);  // 1000 USDT (1:1 ratio)
  const ethAmount = parseUnits("0.1315", 18);   // 0.5 ETH (if ETH = $2000, this is 1:1000 ratio)

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

  // 1. Add USDC/PYUSD Liquidity
  // console.log("📊 Adding USDC/PYUSD liquidity...");
  // try {
  //   // Approve tokens
  //   console.log("  Approving USDC...");
  //   const usdcApproveTx = await usdc.approve(UNISWAP_V2_ROUTER, usdcAmount);
  //   await usdcApproveTx.wait();

  //   console.log("  Approving PYUSD...");
  //   const pyusdApproveTx1 = await pyusd.approve(UNISWAP_V2_ROUTER, pyusdAmount);
  //   await pyusdApproveTx1.wait();

  //   // Add liquidity
  //   console.log("  Adding liquidity to pool...");
  //   const addLiquidityTx = await router.addLiquidity(
  //     USDC_ADDRESS,
  //     PYUSD_ADDRESS,
  //     usdcAmount,
  //     pyusdAmount,
  //     parseUnits("995", 6), // 0.5% slippage
  //     parseUnits("995", 6),
  //     deployer.address,
  //     deadline
  //   );
  //   const receipt = await addLiquidityTx.wait();
  //   console.log("  ✅ USDC/PYUSD liquidity added!");
  //   console.log("  Tx hash:", receipt.hash);
  //   console.log("");
  // } catch (error : any) {
  //   console.error("  ❌ Error adding USDC/PYUSD liquidity:", error.message);
  //   console.log("");
  // }

  // 2. Add USDT/PYUSD Liquidity
  // console.log("📊 Adding USDT/PYUSD liquidity...");
  // try {
  //   // Approve tokens
  //   console.log("  Approving USDT...");
  //   const usdtApproveTx = await usdt.approve(UNISWAP_V2_ROUTER, usdtAmount);
  //   await usdtApproveTx.wait();

  //   console.log("  Approving PYUSD...");
  //   const pyusdApproveTx2 = await pyusd.approve(UNISWAP_V2_ROUTER, pyusdAmount);
  //   await pyusdApproveTx2.wait();

  //   // Add liquidity
  //   console.log("  Adding liquidity to pool...");
  //   const addLiquidityTx = await router.addLiquidity(
  //     USDT_ADDRESS,
  //     PYUSD_ADDRESS,
  //     usdtAmount,
  //     pyusdAmount,
  //     parseUnits("995", 6), // 0.5% slippage
  //     parseUnits("995", 6),
  //     deployer.address,
  //     deadline
  //   );
  //   const receipt = await addLiquidityTx.wait();
  //   console.log("  ✅ USDT/PYUSD liquidity added!");
  //   console.log("  Tx hash:", receipt.hash);
  //   console.log("");
  // } catch (error: any) {
  //   console.error("  ❌ Error adding USDT/PYUSD liquidity:", error.message);
  //   console.log("");
  // }

  // 3. Add ETH/PYUSD Liquidity
  
  
  console.log("📊 Adding ETH/PYUSD liquidity...");
  try {
    // Approve PYUSD
    console.log("  Approving PYUSD...");
    const pyusdApproveTx3 = await pyusd.approve(UNISWAP_V2_ROUTER, pyusdAmount);
    await pyusdApproveTx3.wait();

    // Add liquidity (ETH doesn't need approval)
    console.log("  Adding liquidity to pool...");
    const addLiquidityETHTx = await router.addLiquidityETH(
      PYUSD_ADDRESS,
      pyusdAmount,
      parseUnits("475", 6), // 5% slippage on PYUSD
      parseUnits("0.006575", 18), // 5% slippage on ETH
      deployer.address,
      deadline,
      { value: ethAmount }
    );
    const receipt = await addLiquidityETHTx.wait();
    console.log("  ✅ ETH/PYUSD liquidity added!");
    console.log("  Tx hash:", receipt.hash);
    console.log("");
  } catch (error : any) {
    console.error("  ❌ Error adding ETH/PYUSD liquidity:", error.message);
    console.log("");
  }

  console.log("🎉 Liquidity addition complete!");
  console.log("\n📝 Summary:");
  console.log("  USDC/PYUSD Pool: Ready for swaps");
  console.log("  USDT/PYUSD Pool: Ready for swaps");
  console.log("  ETH/PYUSD Pool: Ready for swaps");
  console.log("\n⚠️  Note: Make sure you have sufficient token balances before running this script!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
