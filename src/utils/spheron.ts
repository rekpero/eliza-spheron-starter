import { SpheronSDK } from "@spheron/protocol-sdk";
import { DeploymentLock } from "./lock.ts";
import { elizaLogger } from "@ai16z/eliza";
import path from "path";
import { UploadService } from "./upload.ts";
import { createProxyServer } from "../proxy/index.ts";
import { computeConfig } from "../compute.ts";
import { ethers } from "ethers";
import { fileURLToPath } from "url";

console.log("Compute Config for Agent: ", computeConfig);

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

export interface ISpheronService {
    getActiveLeases(): Promise<any>;
    getDeployment(deploymentId: string): Promise<any>;
    getDeploymentStatus(deploymentId: string): Promise<boolean>;
    getDeploymentRemainingTime(deploymentId: string): Promise<number>;
    createDeployment(manifest: string): Promise<any>;
    closeDeployment(deploymentId: string): Promise<any>;
    getBalance(token: string): Promise<string>;
    deposit(amount: string, token: string): Promise<any>;
    withdraw(amount: string, token: string): Promise<any>;
}

export interface ComputeConfig {
    name: string;
    image: string;
    replicas?: number;
    ports?: Array<{
        containerPort: number;
        servicePort: number;
    }>;
    env?: Array<{
        name: string;
        value: string;
    }>;
    computeResources?: {
        cpu: number;
        memory: string;
        storage: string;
    };
    duration?: string; // 30min, 1h, 2h, 4h, 8h, 12h, 24h, 1d, 1mon,
    mode?: string; // provider, consumer
    redeployThreshold?: number; // in seconds
    deployMonitorInterval?: number; // in milliseconds
}

interface DeploymentService {
    ready_replicas: number;
    total: number;
}

export class SpheronService implements ISpheronService {
    private sdk: SpheronSDK | null = null;
    private providerProxyUrl: string = "";
    private walletAddress: string = "";

    constructor(privateKey: string, walletAddress: string, providerProxyUrl: string) {
        if (!privateKey) {
            throw new Error("SPHERON_PRIVATE_KEY is required");
        }
        this.sdk = new SpheronSDK("testnet", privateKey);
        this.providerProxyUrl = providerProxyUrl;
        this.walletAddress = walletAddress;
    }

    private ensureInitialized(): void {
        if (!this.sdk) {
            throw new Error("SpheronService not properly initialized");
        }
    }

    async getActiveLeases(): Promise<any> {
        this.ensureInitialized();
        try {
            const leases = await this.sdk!.leases.getLeasesByState(this.walletAddress, {
                state: "active"
            });
            return leases;
        } catch (error: any) {
            throw new Error(`Failed to get active leases: ${error.message}`);
        }
    }

    async getDeployment(deploymentId: string): Promise<any> {
        this.ensureInitialized();
        const maxRetries = 5;
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.sdk!.deployment.getDeployment(deploymentId, this.providerProxyUrl);
            } catch (error: any) {
                if (attempt === maxRetries) {
                    throw new Error(`Failed to get deployment after ${maxRetries} attempts`);
                }
                await delay(1000 * attempt); // Exponential backoff: 1s, 2s, 3s
            }
        }
    }

    async getDeploymentStatus(deploymentId: string): Promise<boolean> {
        this.ensureInitialized();
        try {
            const deployment = await this.getDeployment(deploymentId);
            const service = Object.values(deployment.services)[0] as DeploymentService;
            return service.ready_replicas === service.total;
        } catch (error: any) {
            throw new Error(`Failed to get deployment status: ${error.message}`);
        }
    }

    async getDeploymentRemainingTime(deploymentId: string): Promise<number> {
        this.ensureInitialized();
        try {
            const order = await this.sdk!.orders.getOrderDetails(String(deploymentId));
            const durationInSeconds = order.numOfBlocks / 4;
            const leaseDetails = await this.sdk!.leases.getLeaseDetails(deploymentId);

            const currentTime = Math.floor(Date.now() / 1000); // Convert to seconds
            // Convert endTime to seconds if it's in milliseconds
            const startTime = leaseDetails.startTime && leaseDetails.startTime > 1e12
                ? Math.floor(leaseDetails.startTime / 1000)
                : leaseDetails.startTime || 0;

            return Math.max(0, startTime + durationInSeconds - currentTime);
        } catch (error: any) {
            throw new Error(`Failed to get deployment remaining time: ${error.message}`);
        }
    }

    async createDeployment(manifest: string): Promise<any> {
        this.ensureInitialized();
        const maxRetries = 3;
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.sdk!.deployment.createDeployment(
                    manifest,
                    this.providerProxyUrl
                );
            } catch (error: any) {
                if (attempt === maxRetries) {
                    throw new Error(`Failed to create deployment after ${maxRetries} attempts`);
                }
                await delay(1000 * attempt); // Exponential backoff: 1s, 2s, 3s
            }
        }
    }

    async closeDeployment(deploymentId: string): Promise<any> {
        this.ensureInitialized();
        try {
            return await this.sdk!.deployment.closeDeployment(deploymentId);
        } catch (error: any) {
            throw new Error(`Failed to close deployment: ${error.message}`);
        }
    }

    static createEVMWallet(): { publicKey: string; privateKey: string } {
        const wallet = ethers.Wallet.createRandom();
        return {
            publicKey: wallet.address,
            privateKey: wallet.privateKey
        };
    }

    async getBalance(token: string): Promise<any> {
        this.ensureInitialized();
        try {
            return await this.sdk!.escrow.getUserBalance(token, this.walletAddress);
        } catch (error: any) {
            throw new Error(`Failed to get balance: ${error.message}`);
        }
    }

    async deposit(amount: string, token: string): Promise<any> {
        this.ensureInitialized();
        const maxRetries = 3;
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.sdk!.escrow.depositBalance({
                    token,
                    amount,
                    onSuccessCallback: (receipt) => {
                        console.log("Successfully deposited:", receipt);
                    },
                    onFailureCallback: (error) => {
                        console.error("Deposit failed:", error);
                    },
                });
            } catch (error: any) {
                if (attempt === maxRetries) {
                    throw new Error(`Failed to deposit after ${maxRetries} attempts: ${error.message}`);
                }
                await delay(1000 * attempt); // Exponential backoff: 1s, 2s, 3s
            }
        }
    }

    async withdraw(amount: string, token: string): Promise<any> {
        this.ensureInitialized();
        const maxRetries = 3;
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.sdk!.escrow.withdrawBalance({
                    token,
                    amount,
                    onSuccessCallback: (receipt) => {
                        console.log("Successfully withdrawn:", receipt);
                    },
                    onFailureCallback: (error) => {
                        console.error("Withdrawal failed:", error);
                    },
                });
            } catch (error: any) {
                if (attempt === maxRetries) {
                    throw new Error(`Failed to withdraw after ${maxRetries} attempts: ${error.message}`);
                }
                await delay(1000 * attempt); // Exponential backoff: 1s, 2s, 3s
            }
        }
    }

    generateSpheronYaml(config: ComputeConfig): string {
        const yaml = `version: "1.0"

services:
  ${config.name}:
    image: ${config.image}
    ${config.ports
                ? `expose:
      ${config.ports
                    .map(
                        (p) => `- port: ${p.containerPort}
        as: ${p.servicePort}
        to:
          - global: true`
                    )
                    .join("\n      ")}`
                : ""
            }
    ${config.env
                ? `env:
      ${config.env.map((e) => `- ${e.name}=${e.value}`).join("\n      ")}`
                : ""
            }

profiles:
  name: ${config.name}
  duration: ${config.duration || "24h"}
  mode: ${config.mode || "provider"}
  tier:
    - community
    - secure
  compute:
    ${config.name}:
      resources:
        cpu:
          units: ${config.computeResources?.cpu || 2}
        memory:
          size: ${config.computeResources?.memory || "2Gi"}
        storage:
          - size: ${config.computeResources?.storage || "10Gi"}
  placement:
    westcoast:
      pricing:
        ${config.name}:
          token: CST
          amount: 1

deployment:
  ${config.name}:
    westcoast:
      profile: ${config.name}
      count: ${config.replicas || 1}`;

        return yaml.trim();
    }



}


async function rotateWalletAndFunds(spheronService: SpheronService, minimumDepositAmount: string, token: string = 'CST'): Promise<{ newWallet: { publicKey: string; privateKey: string }, newSpheronService: SpheronService }> {
    try {
        // Get current balance
        const balanceInfo = await spheronService.getBalance(token);
        if (!balanceInfo) {
            throw new Error('No balance to rotate');
        }

        // Ensure unlockedBalance and decimals exist and are valid
        if (!balanceInfo.unlockedBalance || !balanceInfo.token?.decimal) {
            throw new Error('Invalid balance info structure');
        }

        // Convert to BigInt for precise calculation
        const unlockedBalance = BigInt(balanceInfo.unlockedBalance);
        const decimal = BigInt(balanceInfo.token.decimal);
        const divisor = BigInt(10) ** decimal;

        // Calculate withdrawal amount and convert to string with proper decimal places
        const withdrawalAmount = (Number(unlockedBalance) / Number(divisor)) - 0.001

        if (!withdrawalAmount) {
            throw new Error('No unlocked balance available to rotate');
        }

        // Create new wallet
        const newWallet = SpheronService.createEVMWallet();
        elizaLogger.info("New wallet created for the new agent...");

        // Create provider and wallet instances
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://spheron-devnet-eth.rpc.caldera.xyz/http');
        const oldWallet = new ethers.Wallet(process.env.SPHERON_PRIVATE_KEY!, provider);

        // Withdraw unlocked CST from current wallet
        await spheronService.withdraw(withdrawalAmount.toString(), token);
        elizaLogger.info(`Withdrawn all the current funds (${withdrawalAmount} USD) from current wallet, waiting for sometime...`);
        // Wait a few seconds for withdrawal to process
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Get CST token contract
        const cstTokenAddress = process.env.CST_TOKEN_ADDRESS || '0xA76CF27b51eb93c417CcE78af5cf0a3E2D9aa55c';
        const cstAbi = ["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address account) view returns (uint256)"];
        const cstContract = new ethers.Contract(cstTokenAddress, cstAbi, oldWallet);

        // Get the total balance after withdrawal
        const totalBalance = await cstContract.balanceOf(oldWallet.address);
        elizaLogger.info(`Total balance after withdrawal: ${(Number(totalBalance) / Number(divisor))} USD`);
        // Transfer all CST tokens to new wallet
        if (totalBalance > 0) {
            const cstTx = await cstContract.transfer(newWallet.publicKey, totalBalance);
            await cstTx.wait();
            elizaLogger.info("Transferred all the funds to new wallet...");
        }

        // Transfer ETH (leave 0.001 for potential future gas fees)
        const ethBalance = await provider.getBalance(oldWallet.address);
        const reserveAmount = ethers.parseEther("0.001");
        const transferAmount = ethBalance - reserveAmount;
        elizaLogger.info(`ETH balance on the current agent wallet: ${parseFloat(ethers.formatEther(transferAmount)).toFixed(2)} ETH`);

        if (transferAmount > 0) {
            const ethTx = await oldWallet.sendTransaction({
                to: newWallet.publicKey,
                value: transferAmount
            });
            await ethTx.wait();
            elizaLogger.info("Transferred ETH to new agent wallet...");
        }

        // Create new instance with new wallet
        const newSpheronService = new SpheronService(
            newWallet.privateKey,
            newWallet.publicKey,
            process.env.SPHERON_PROVIDER_PROXY_URL || `http://localhost:${process.env.SPHERON_PROXY_PORT || 3040}`
        );

        // Deposit minimum amount to new wallet
        await newSpheronService.deposit(minimumDepositAmount, token);
        elizaLogger.info(`Deposited minimum amount (${minimumDepositAmount} USD) to new agent wallet, waiting for sometime...`);
        // Wait a few seconds for withdrawal to process
        await new Promise(resolve => setTimeout(resolve, 5000));

        return {
            newWallet,
            newSpheronService
        };
    } catch (error: any) {
        throw new Error(`Failed to rotate wallet and funds: ${error.message}`);
    }
}

async function monitorAndRedeployIfNeeded(spheronService: SpheronService) {
    const lock = DeploymentLock.getInstance();

    try {
        const activeLeases = await spheronService.getActiveLeases();

        if (!activeLeases.leases || activeLeases.leases.length === 0) {
            elizaLogger.warn("No active deployments found");
            return;
        }

        const lease = activeLeases.leases[0];
        const deploymentId = lease.leaseId;
        const remainingTime = await spheronService.getDeploymentRemainingTime(deploymentId);

        if (remainingTime <= computeConfig.redeployThreshold) {
            const minutes = Math.floor(remainingTime / 60);
            const seconds = remainingTime % 60;
            elizaLogger.log(`New Agent needs to be deployed (${minutes}m ${seconds}s remaining)`);

            // Try to acquire the lock
            if (!await lock.acquire()) {
                elizaLogger.info("Deployment already in progress, skipping...");
                return;
            }

            elizaLogger.info("Deployment lock acquired, starting deployment process...");

            try {
                // Upload SQLite database to Lighthouse
                if (process.env.LIGHTHOUSE_API_KEY) {
                    try {
                        const uploadService = new UploadService(process.env.LIGHTHOUSE_API_KEY || '');
                        const dbPath = path.join(__dirname, "../../data/db.sqlite");

                        const uploadResponse = await uploadService.upload(dbPath);
                        elizaLogger.success(`Database uploaded. Hash: ${uploadResponse.data.Hash}`);

                        process.env.BACKUP_DB_URL = `https://gateway.lighthouse.storage/ipfs/${uploadResponse.data.Hash}`;
                    } catch (error) {
                        console.error('Failed to upload backup database:', error);
                        elizaLogger.error(`Failed to upload backup database: ${error.message}`);
                    }
                }
                const { newWallet, newSpheronService } = await rotateWalletAndFunds(spheronService, '15', 'CST');

                // Generate new deployment config based on environment
                const config = computeConfig;
                config.env = [
                    ...Object.entries(process.env)
                        .filter(([name]) => name === name.toUpperCase())
                        .filter(([name]) => !['SPHERON_WALLET_ADDRESS', 'SPHERON_PRIVATE_KEY'].includes(name))  // Filter out existing wallet credentials
                        .map(([name, value]) => ({ name, value: value || '' })),
                    ...(config.env || []),
                    { name: 'SPHERON_WALLET_ADDRESS', value: newWallet.publicKey },
                    { name: 'SPHERON_PRIVATE_KEY', value: newWallet.privateKey },
                ]

                // Generate manifest
                const manifest = newSpheronService.generateSpheronYaml(config);
                elizaLogger.info("Agent creation happening with manifest: \n", manifest);

                // Create new deployment
                const newDeployment = await newSpheronService.createDeployment(manifest);
                elizaLogger.success(`Created new agent deployment: ${newDeployment.leaseId}`);

                // Wait for new deployment to be ready
                let isReady = false;
                const maxAttempts = 42; // 6 minutes with 10-second intervals
                let attempts = 0;

                while (!isReady && attempts < maxAttempts) {
                    const status = await newSpheronService.getDeploymentStatus(newDeployment.leaseId);
                    console.log(`Deployment status (attempt ${attempts + 1}/${maxAttempts}):`, status);

                    if (status) {
                        isReady = true;
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds between checks
                        attempts++;
                    }
                }

                if (isReady) {
                    await spheronService.closeDeployment(deploymentId);
                    elizaLogger.success(`Closed old agent: ${deploymentId}`);
                    elizaLogger.info("New agent created successfully, closing old agent process...");
                } else {
                    elizaLogger.error(`New agent not ready after ${maxAttempts} attempts`);
                    throw new Error('Deployment timeout');
                }
            } catch (error) {
                elizaLogger.error("Agent creation failed:", error);
                throw error;
            } finally {
                // Make sure to release the lock even if deployment fails
                setTimeout(() => {
                    lock.release();
                    elizaLogger.info("Agent creation lock released");
                    process.exit(0);
                }, 10000);
            }
        } else {
            const minutes = Math.floor(remainingTime / 60);
            const seconds = remainingTime % 60;
            elizaLogger.info(`Skipping creating new agent, enough time left (${minutes}m ${seconds}s) to spin a new agent`);
        }
    } catch (error) {
        elizaLogger.error("Error in agent creation monitoring:", error);
        // Make sure to release the lock in case of unexpected errors
        lock.release();
    }
}

export const startService = async () => {
    if (!process.env.SPHERON_PROVIDER_PROXY_URL) {
        console.log("SPHERON_PROVIDER_PROXY_URL is not set, starting proxy server");
        // Initialize proxy server
        const proxyServer = createProxyServer(Number(process.env.SPHERON_PROXY_PORT) || 3040);

        // Start the proxy server
        proxyServer.listen(Number(process.env.SPHERON_PROXY_PORT) || 3040, () => {
            elizaLogger.success(`Proxy server started on port http://localhost:${process.env.SPHERON_PROXY_PORT || 3040}`);
        });
    }

    // Initialize Spheron service
    const spheronService = new SpheronService(
        process.env.SPHERON_PRIVATE_KEY || '',
        process.env.SPHERON_WALLET_ADDRESS || '',
        process.env.SPHERON_PROVIDER_PROXY_URL || `http://localhost:${process.env.SPHERON_PROXY_PORT || 3040}`
    );

    // Start monitoring deployments
    setInterval(() => {
        const lock = DeploymentLock.getInstance();
        if (lock.isLocked()) {
            elizaLogger.info("Skipping agent creation check - deployment already in progress");
            return;
        }

        monitorAndRedeployIfNeeded(spheronService)
            .catch(error => {
                elizaLogger.error("Error in agent creation monitoring interval:", error);
            });
    }, computeConfig.deployMonitorInterval);
}

