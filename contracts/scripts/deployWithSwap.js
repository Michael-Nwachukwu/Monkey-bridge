const hre = require("hardhat");

async function main() {
  console.log("Deploying PaymentEscrowWithSwap contract...");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Get balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  // Backend wallet address (should be in .env)
  const backendWallet = process.env.BACKEND_WALLET || deployer.address;

  // Get network
  const networkName = hre.network.name;
  console.log("Network:", networkName);

  // Sepolia token addresses
  const PYUSD_ADDRESS = "0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9";
  const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  const USDT_ADDRESS = "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0";
  const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";

  if (networkName !== "sepolia") {
    throw new Error("This script is designed for Sepolia testnet only");
  }

  console.log("Using Sepolia addresses:");
  console.log("  PYUSD:", PYUSD_ADDRESS);
  console.log("  USDC:", USDC_ADDRESS);
  console.log("  USDT:", USDT_ADDRESS);
  console.log("  Uniswap Router:", UNISWAP_V2_ROUTER);

  // Deploy PaymentEscrowWithSwap
  const PaymentEscrowWithSwap = await hre.ethers.getContractFactory("PaymentEscrowWithSwap");
  const escrow = await PaymentEscrowWithSwap.deploy(
    PYUSD_ADDRESS,
    USDC_ADDRESS,
    USDT_ADDRESS,
    UNISWAP_V2_ROUTER,
    backendWallet
  );

  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log("PaymentEscrowWithSwap deployed to:", escrowAddress);

  // Grant backend role to backend wallet (if different from deployer)
  if (backendWallet !== deployer.address) {
    console.log("Granting BACKEND_ROLE to:", backendWallet);
    const BACKEND_ROLE = await escrow.BACKEND_ROLE();
    await escrow.grantRole(BACKEND_ROLE, backendWallet);
    console.log("BACKEND_ROLE granted");
  }

  // Save deployment info
  const deploymentInfo = {
    network: networkName,
    escrowAddress: escrowAddress,
    pyusdAddress: PYUSD_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    usdtAddress: USDT_ADDRESS,
    uniswapRouter: UNISWAP_V2_ROUTER,
    backendWallet: backendWallet,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    blockNumber: await hre.ethers.provider.getBlockNumber()
  };

  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  // Save to file
  const fs = require("fs");
  const path = require("path");
  const deploymentsDir = path.join(__dirname, "../deployments");

  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const filename = `${networkName}-with-swap-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`\nDeployment info saved to: deployments/${filename}`);

  // Verify on Etherscan
  console.log("\nWaiting for block confirmations...");
  await escrow.deploymentTransaction().wait(5); // Wait 5 blocks

  console.log("Verifying contract on Etherscan...");
  try {
    await hre.run("verify:verify", {
      address: escrowAddress,
      constructorArguments: [
        PYUSD_ADDRESS,
        USDC_ADDRESS,
        USDT_ADDRESS,
        UNISWAP_V2_ROUTER,
        backendWallet
      ]
    });
    console.log("Contract verified!");
  } catch (error) {
    console.log("Verification failed:", error.message);
  }

  console.log("\n=== Next Steps ===");
  console.log("1. Update src/config.ts with new contract address:", escrowAddress);
  console.log("2. Update backend/.env with:");
  console.log(`   ESCROW_CONTRACT_ADDRESS=${escrowAddress}`);
  console.log("3. Run addLiquidity.ts script to create Uniswap pools");
  console.log("4. Test swap and deposit flow");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
