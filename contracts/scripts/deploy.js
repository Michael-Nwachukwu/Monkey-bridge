const hre = require("hardhat");

async function main() {
  console.log("Deploying PaymentEscrow contract...");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Get balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  // PYUSD addresses on different networks
  const PYUSD_ADDRESSES = {
    mainnet: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8",
    polygon: "0x9aA........", // Update with actual Polygon PYUSD address
    sepolia: "0x...", // Deploy mock PYUSD for testing
    mumbai: "0x...", // Deploy mock PYUSD for testing
    localhost: "0x..." // Will deploy mock
  };

  // Backend wallet address (should be in .env)
  const backendWallet = process.env.BACKEND_WALLET || deployer.address;

  // Get network
  const networkName = hre.network.name;
  console.log("Network:", networkName);

  let pyusdAddress = PYUSD_ADDRESSES[networkName];

  // Deploy mock PYUSD for testing on testnets/localhost
  if (!pyusdAddress || networkName === "localhost" || networkName === "hardhat") {
    console.log("Deploying Mock PYUSD for testing...");
    const MockPYUSD = await hre.ethers.getContractFactory("MockERC20");
    const mockPYUSD = await MockPYUSD.deploy(
      "PayPal USD",
      "PYUSD",
      6 // 6 decimals like real PYUSD
    );
    await mockPYUSD.waitForDeployment();
    pyusdAddress = await mockPYUSD.getAddress();
    console.log("Mock PYUSD deployed to:", pyusdAddress);

    // Mint some test tokens to deployer
    const mintAmount = hre.ethers.parseUnits("10000", 6); // 10,000 PYUSD
    await mockPYUSD.mint(deployer.address, mintAmount);
    console.log("Minted 10,000 test PYUSD to deployer");
  }

  // Deploy PaymentEscrow
  const PaymentEscrow = await hre.ethers.getContractFactory("PaymentEscrow");
  const escrow = await PaymentEscrow.deploy(pyusdAddress, backendWallet);

  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log("PaymentEscrow deployed to:", escrowAddress);

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
    pyusdAddress: pyusdAddress,
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

  const filename = `${networkName}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`\nDeployment info saved to: deployments/${filename}`);

  // Verify on Etherscan (if not localhost)
  if (networkName !== "localhost" && networkName !== "hardhat") {
    console.log("\nWaiting for block confirmations...");
    await escrow.deploymentTransaction().wait(5); // Wait 5 blocks

    console.log("Verifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: escrowAddress,
        constructorArguments: [pyusdAddress, backendWallet]
      });
      console.log("Contract verified!");
    } catch (error) {
      console.log("Verification failed:", error.message);
    }
  }

  console.log("\n=== Next Steps ===");
  console.log("1. Update src/config.js with contract address:", escrowAddress);
  console.log("2. Update backend/.env with:");
  console.log(`   ESCROW_CONTRACT_ADDRESS=${escrowAddress}`);
  console.log(`   PYUSD_TOKEN_ADDRESS=${pyusdAddress}`);
  console.log("3. Fund backend wallet with ETH for gas fees");
  console.log("4. Test deposit and release flow");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
