import lighthouse from '@lighthouse-web3/sdk';

interface UploadResponse {
    data: {
        Name: string;
        Hash: string;
        Size: string;
    };
}

export class UploadService {
    private apiKey: string;

    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error('Lighthouse API key is required');
        }
        this.apiKey = apiKey;
    }

    /**
     * Upload a file or folder to Lighthouse
     * @param path - Path to the file or folder
     * @returns Upload response with file details
     */
    async upload(path: string): Promise<UploadResponse> {
        try {
            const response = await lighthouse.upload(
                path,
                this.apiKey
            );

            return response;
        } catch (error) {
            console.error('Lighthouse upload failed:', error);
            throw new Error('Failed to upload file to Lighthouse');
        }
    }

    /**
     * Upload a buffer directly to Lighthouse
     * @param buffer - Data buffer to upload
     * @returns Upload response with file details
     */
    async uploadBuffer(buffer: Buffer): Promise<UploadResponse> {
        try {
            const response = await lighthouse.uploadBuffer(buffer, this.apiKey);
            return response;
        } catch (error) {
            console.error('Lighthouse buffer upload failed:', error);
            throw new Error('Failed to upload buffer to Lighthouse');
        }
    }
}
