// Create a proper lock class for better management
export class DeploymentLock {
    private static instance: DeploymentLock;
    private _isLocked: boolean = false;

    private constructor() { }

    static getInstance(): DeploymentLock {
        if (!DeploymentLock.instance) {
            DeploymentLock.instance = new DeploymentLock();
        }
        return DeploymentLock.instance;
    }

    isLocked(): boolean {
        return this._isLocked;
    }

    async acquire(): Promise<boolean> {
        if (this._isLocked) {
            return false;
        }
        this._isLocked = true;
        return true;
    }

    release(): void {
        this._isLocked = false;
    }
}