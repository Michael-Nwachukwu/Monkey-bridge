import { ethers } from "hardhat";
import { formatUnits } from "ethers";

async function main() {
  console.log("🔍 Checking Uniswap V2 Pool Status on Sepolia...\n");

  const [deployer] = await ethers.getSigners();

  // Addresses
  const UNISWAP_V2_FACTORY = "0x7E0987E5b3a30e3f2828572Bb659A548460a3003";
  const PYUSD_ADDRESS = "0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9";
  const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  const WETH_ADDRESS = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";

  const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)"
  ];

  const PAIR_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function totalSupply() external view returns (uint256)"
  ];

  const factory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, deployer);

  // Check USDC/PYUSD pool
  console.log("📊 USDC/PYUSD Pool:");
  const usdcPyusdPair = await factory.getPair(USDC_ADDRESS, PYUSD_ADDRESS);
  if (usdcPyusdPair === ethers.ZeroAddress) {
    console.log("  ❌ Pool does not exist\n");
  } else {
    console.log("  ✅ Pool exists at:", usdcPyusdPair);
    const pair = new ethers.Contract(usdcPyusdPair, PAIR_ABI, deployer);
    const reserves = await pair.getReserves();
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    const totalSupply = await pair.totalSupply();

    const isUsdcToken0 = token0.toLowerCase() === USDC_ADDRESS.toLowerCase();
    const usdcReserve = isUsdcToken0 ? reserves[0] : reserves[1];
    const pyusdReserve = isUsdcToken0 ? reserves[1] : reserves[0];

    console.log("  USDC Reserve:", formatUnits(usdcReserve, 6));
    console.log("  PYUSD Reserve:", formatUnits(pyusdReserve, 6));
    console.log("  Total LP Tokens:", formatUnits(totalSupply, 18));
    console.log("");
  }

  // Check ETH/PYUSD pool
  console.log("📊 ETH/PYUSD Pool:");
  const ethPyusdPair = await factory.getPair(WETH_ADDRESS, PYUSD_ADDRESS);
  if (ethPyusdPair === ethers.ZeroAddress) {
    console.log("  ❌ Pool does not exist");
    console.log("  💡 You need to create this pool by adding initial liquidity\n");
  } else {
    console.log("  ✅ Pool exists at:", ethPyusdPair);
    const pair = new ethers.Contract(ethPyusdPair, PAIR_ABI, deployer);
    const reserves = await pair.getReserves();
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    const totalSupply = await pair.totalSupply();

    const isWethToken0 = token0.toLowerCase() === WETH_ADDRESS.toLowerCase();
    const wethReserve = isWethToken0 ? reserves[0] : reserves[1];
    const pyusdReserve = isWethToken0 ? reserves[1] : reserves[0];

    console.log("  WETH Reserve:", formatUnits(wethReserve, 18));
    console.log("  PYUSD Reserve:", formatUnits(pyusdReserve, 6));
    console.log("  Total LP Tokens:", formatUnits(totalSupply, 18));
    console.log("");
  }

  // Check token balances
  const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
  const pyusd = new ethers.Contract(PYUSD_ADDRESS, ERC20_ABI, deployer);

  const pyusdBalance = await pyusd.balanceOf(deployer.address);
  const ethBalance = await ethers.provider.getBalance(deployer.address);

  console.log("💰 Your Balances:");
  console.log("  PYUSD:", formatUnits(pyusdBalance, 6));
  console.log("  ETH:", formatUnits(ethBalance, 18));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
