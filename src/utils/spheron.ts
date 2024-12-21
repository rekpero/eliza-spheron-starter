import { SpheronSDK } from "@spheron/protocol-sdk";
import { DeploymentLock } from "./lock.ts";
import { elizaLogger } from "@ai16z/eliza";
import path from "path";
import { UploadService } from "./upload.ts";
import { createProxyServer } from "../proxy/index.ts";
import { computeConfig } from "../compute.ts";
import { ethers } from "ethers";

console.log("Compute Config for Agent: ", computeConfig);

export interface ISpheronService {
    getActiveLeases(): Promise<any>;
    getDeployment(deploymentId: string): Promise<any>;
    getDeploymentStatus(deploymentId: string): Promise<boolean>;
    getDeploymentRemainingTime(deploymentId: string): Promise<number>;
    createDeployment(manifest: string): Promise<any>;
    closeDeployment(deploymentId: string): Promise<any>;
    getBalance(token: string): Promise<string>;
    deposit(amount: string, token: string): Promise<any>;
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

    async getBalance(token: string): Promise<string> {
        this.ensureInitialized();
        try {
            return await this.sdk!.escrow.getUserBalance(token, this.walletAddress);
        } catch (error: any) {
            throw new Error(`Failed to get balance: ${error.message}`);
        }
    }

    async deposit(amount: string, token: string): Promise<any> {
        this.ensureInitialized();
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
            throw new Error(`Failed to deposit: ${error.message}`);
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


    async monitorAndRedeployIfNeeded() {
        const lock = DeploymentLock.getInstance();

        try {
            const activeLeases = await this.getActiveLeases();

            if (!activeLeases.leases || activeLeases.leases.length === 0) {
                elizaLogger.warn("No active deployments found");
                return;
            }

            const lease = activeLeases.leases[0];
            const deploymentId = lease.leaseId;
            const remainingTime = await this.getDeploymentRemainingTime(deploymentId);

            if (remainingTime <= computeConfig.redeployThreshold) {
                elizaLogger.log(`New Agent needs to be deployed (${remainingTime}s remaining)`);

                // Try to acquire the lock
                if (!await lock.acquire()) {
                    elizaLogger.info("Deployment already in progress, skipping...");
                    return;
                }

                elizaLogger.info("Deployment lock acquired, starting deployment process...");

                try {
                    // Upload SQLite database to Lighthouse
                    if (process.env.LIGHTHOUSE_API_KEY) {
                        const uploadService = new UploadService(process.env.LIGHTHOUSE_API_KEY || '');
                        const dbPath = path.join(__dirname, "../data/db.sqlite");

                        try {
                            const uploadResponse = await uploadService.upload(dbPath);
                            elizaLogger.success(`Database uploaded. Hash: ${uploadResponse.data.Hash}`);

                            process.env.BACKUP_DB_URL = `https://gateway.lighthouse.storage/ipfs/${uploadResponse.data.Hash}`;
                        } catch (error) {
                            elizaLogger.error("Failed to upload database:", error);
                            return;
                        }
                    }

                    // Generate new deployment config based on environment
                    const config = computeConfig;
                    config.env = [
                        ...Object.entries(process.env)
                            .filter(([name]) => name === name.toUpperCase())
                            .map(([name, value]) => ({ name, value: value || '' })),
                        ...(config.env || [])
                    ]

                    // Generate manifest
                    const manifest = this.generateSpheronYaml(config);
                    elizaLogger.info("Agent creation happening with manifest: \n", manifest);

                    // Create new deployment
                    const newDeployment = await this.createDeployment(manifest);
                    elizaLogger.success(`Created new agent deployment: ${newDeployment.leaseId}`);

                    // Wait for new deployment to be ready
                    let isReady = false;
                    const maxAttempts = 42; // 6 minutes with 10-second intervals
                    let attempts = 0;

                    while (!isReady && attempts < maxAttempts) {
                        const status = await this.getDeploymentStatus(newDeployment.leaseId);
                        console.log(`Deployment status (attempt ${attempts + 1}/${maxAttempts}):`, status);

                        if (status) {
                            isReady = true;
                        } else {
                            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds between checks
                            attempts++;
                        }
                    }

                    if (isReady) {
                        await this.closeDeployment(deploymentId);
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
                    }, 30000);
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

}

export const startService = async () => {
    console.log("SPHERON_PROVIDER_PROXY_URL: ", process.env.SPHERON_PROVIDER_PROXY_URL);
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

        spheronService.monitorAndRedeployIfNeeded()
            .catch(error => {
                elizaLogger.error("Error in agent creation monitoring interval:", error);
            });
    }, computeConfig.deployMonitorInterval);
}

