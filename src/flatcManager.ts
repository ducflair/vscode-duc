import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as childProcess from 'child_process';
import * as util from 'util';
import * as extract from 'extract-zip';

const execFile = util.promisify(childProcess.execFile);

/**
 * Manages the flatc binary
 */
export class FlatcManager {
    private static instance: FlatcManager;
    private extensionPath: string;
    private flatcPath: string | null = null;
    private isDownloading = false;

    private constructor(context: vscode.ExtensionContext) {
        this.extensionPath = context.extensionPath;
    }

    public static getInstance(context: vscode.ExtensionContext): FlatcManager {
        if (!FlatcManager.instance) {
            FlatcManager.instance = new FlatcManager(context);
        }
        return FlatcManager.instance;
    }

    /**
     * Get the path to the flatc binary
     */
    public async getFlatcPath(): Promise<string> {
        // If we've already found or downloaded flatc, return its path
        if (this.flatcPath) {
            return this.flatcPath;
        }

        console.debug('FlatcManager: Looking for flatc binary');
        
        // Check if flatc is already installed on the system
        try {
            const result = await execFile('flatc', ['--version']);
            console.debug(`FlatcManager: Found flatc in PATH: ${result.stdout.trim()}`);
            this.flatcPath = 'flatc'; // It's in the PATH
            return this.flatcPath;
        } catch (error) {
            console.debug('FlatcManager: flatc not found in PATH, checking extension directory');
            
            // Not found in PATH, check if we have it in our extension directory
            const platform = os.platform();
            const binDir = path.join(this.extensionPath, 'bin');
            const flatcBin = platform === 'win32' ? 'flatc.exe' : 'flatc';
            const localFlatcPath = path.join(binDir, flatcBin);

            console.debug(`FlatcManager: Checking for flatc at ${localFlatcPath}`);
            
            if (fs.existsSync(localFlatcPath)) {
                console.debug('FlatcManager: flatc found in extension directory');
                // Make sure it's executable on Unix platforms
                if (platform !== 'win32') {
                    try {
                        fs.chmodSync(localFlatcPath, 0o755);
                        console.debug('FlatcManager: Set executable permissions');
                    } catch (e) {
                        console.error(`FlatcManager: Error setting executable permissions: ${e}`);
                    }
                }
                
                // Verify the binary works
                try {
                    const result = await execFile(localFlatcPath, ['--version']);
                    console.debug(`FlatcManager: Local flatc version: ${result.stdout.trim()}`);
                    this.flatcPath = localFlatcPath;
                    return localFlatcPath;
                } catch (e) {
                    console.error(`FlatcManager: Local flatc execution failed: ${e}`);
                    // Continue to download since local binary doesn't work
                }
            } else {
                console.debug('FlatcManager: flatc not found in extension directory');
            }

            // Need to download it
            console.debug('FlatcManager: Need to download flatc');
            return this.downloadFlatc();
        }
    }

    /**
     * Check if flatc is available
     */
    public async isFlatcAvailable(): Promise<boolean> {
        try {
            await this.getFlatcPath();
            return true;
        } catch (_error) {
            return false;
        }
    }

    /**
     * Download flatc for the current platform
     */
    private async downloadFlatc(): Promise<string> {
        if (this.isDownloading) {
            console.debug('FlatcManager: Already downloading flatc');
            throw new Error('Already downloading flatc');
        }

        this.isDownloading = true;
        console.debug('FlatcManager: Starting flatc download');

        try {
            // Determine download URL based on platform
            const platform = os.platform();
            const arch = os.arch();
            
            console.debug(`FlatcManager: Platform: ${platform}, Architecture: ${arch}`);
            
            const flatbuffersVersion = '23.5.26'; // Use a stable version
            let downloadUrl: string;
            const flatcBin = platform === 'win32' ? 'flatc.exe' : 'flatc';
            
            if (platform === 'win32') {
                downloadUrl = `https://github.com/google/flatbuffers/releases/download/v${flatbuffersVersion}/Windows.flatc.binary.zip`;
            } else if (platform === 'darwin') {
                if (arch === 'arm64') {
                    downloadUrl = `https://github.com/google/flatbuffers/releases/download/v${flatbuffersVersion}/Mac.flatc.binary.zip`;
                } else {
                    downloadUrl = `https://github.com/google/flatbuffers/releases/download/v${flatbuffersVersion}/Mac.flatc.binary.zip`;
                }
            } else if (platform === 'linux') {
                downloadUrl = `https://github.com/google/flatbuffers/releases/download/v${flatbuffersVersion}/Linux.flatc.binary.clang++-12.zip`;
            } else {
                console.error(`FlatcManager: Unsupported platform: ${platform}`);
                throw new Error(`Unsupported platform: ${platform}`);
            }

            console.debug(`FlatcManager: Download URL: ${downloadUrl}`);
            vscode.window.showInformationMessage('Downloading FlatBuffers compiler for Duc Viewer...');

            // Create bin directory if it doesn't exist
            const binDir = path.join(this.extensionPath, 'bin');
            if (!fs.existsSync(binDir)) {
                console.debug(`FlatcManager: Creating bin directory at ${binDir}`);
                fs.mkdirSync(binDir, { recursive: true });
            }

            // Download zip file
            const zipPath = path.join(os.tmpdir(), `flatc-${Date.now()}.zip`);
            console.debug(`FlatcManager: Downloading to ${zipPath}`);
            await this.downloadFile(downloadUrl, zipPath);
            console.debug('FlatcManager: Download complete');

            // Extract zip file
            console.debug(`FlatcManager: Extracting to ${binDir}`);
            await extract(zipPath, { dir: binDir });
            console.debug('FlatcManager: Extraction complete');

            // Path to extracted flatc
            const flatcPath = path.join(binDir, flatcBin);
            console.debug(`FlatcManager: Flatc binary path: ${flatcPath}`);

            // Verify the file exists
            if (!fs.existsSync(flatcPath)) {
                console.error(`FlatcManager: Extracted flatc binary not found at ${flatcPath}`);
                
                // List files in bin directory to debug
                try {
                    const files = fs.readdirSync(binDir);
                    console.debug(`FlatcManager: Files in bin directory: ${files.join(', ')}`);
                } catch (e) {
                    console.error(`FlatcManager: Error listing bin directory: ${e}`);
                }
                
                throw new Error(`Extracted flatc binary not found at ${flatcPath}`);
            }

            // Make executable on Unix platforms
            if (platform !== 'win32') {
                console.debug('FlatcManager: Setting executable permissions');
                fs.chmodSync(flatcPath, 0o755);
            }

            // Clean up zip file
            console.debug('FlatcManager: Cleaning up zip file');
            fs.unlinkSync(zipPath);

            // Verify it works
            console.debug('FlatcManager: Verifying flatc binary');
            try {
                const result = await execFile(flatcPath, ['--version']);
                console.debug(`FlatcManager: Flatc version: ${result.stdout.trim()}`);
            } catch (error) {
                const execError = error as Error;
                console.error(`FlatcManager: Failed to run the downloaded flatc binary: ${execError.message}`);
                throw new Error(`Failed to run the downloaded flatc binary: ${execError.message}`);
            }

            this.flatcPath = flatcPath;
            console.debug('FlatcManager: FlatBuffers compiler downloaded successfully');
            vscode.window.showInformationMessage('FlatBuffers compiler downloaded successfully!');
            
            return flatcPath;
        } catch (err) {
            const error = err as Error;
            console.error(`FlatcManager: Failed to download flatc: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to download flatc: ${error.message}`);
            throw new Error(`Failed to download flatc: ${error.message}`);
        } finally {
            this.isDownloading = false;
        }
    }

    /**
     * Download a file from a URL to a local file
     */
    private async downloadFile(url: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download file: ${response.statusCode} ${response.statusMessage}`));
                    return;
                }

                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        });
    }
} 