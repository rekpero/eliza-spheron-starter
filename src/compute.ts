import { ComputeConfig } from "./utils/spheron.ts";

export const computeConfig: ComputeConfig = {
    name: "eliza-spheron-starter",
    image: "rekpero/eliza-spheron-starter:latest",
    ports: [
        { containerPort: 3000, servicePort: 3000 },
    ],
    env: [],
    computeResources: {
        cpu: 4,
        memory: "8Gi",
        storage: "100Gi"
    },
    duration: "1h",
    mode: "provider",
    redeployThreshold: 10 * 60,
    deployMonitorInterval: 30 * 1000,
}