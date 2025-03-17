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

        // Check if flatc is already installed on the system
        try {
            await execFile('flatc', ['--version']);
            this.flatcPath = 'flatc'; // It's in the PATH
            return this.flatcPath;
        } catch (_error) {
            // Not found in PATH, check if we have it in our extension directory
            const platform = os.platform();
            const binDir = path.join(this.extensionPath, 'bin');
            const flatcBin = platform === 'win32' ? 'flatc.exe' : 'flatc';
            const localFlatcPath = path.join(binDir, flatcBin);

            if (fs.existsSync(localFlatcPath)) {
                // Make sure it's executable on Unix platforms
                if (platform !== 'win32') {
                    fs.chmodSync(localFlatcPath, 0o755);
                }
                this.flatcPath = localFlatcPath;
                return localFlatcPath;
            }

            // Need to download it
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
            throw new Error('Already downloading flatc');
        }

        this.isDownloading = true;

        try {
            // Determine download URL based on platform
            const platform = os.platform();
            const arch = os.arch();
            
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
                throw new Error(`Unsupported platform: ${platform}`);
            }

            vscode.window.showInformationMessage('Downloading FlatBuffers compiler for Duc Viewer...');

            // Create bin directory if it doesn't exist
            const binDir = path.join(this.extensionPath, 'bin');
            if (!fs.existsSync(binDir)) {
                fs.mkdirSync(binDir, { recursive: true });
            }

            // Download zip file
            const zipPath = path.join(os.tmpdir(), `flatc-${Date.now()}.zip`);
            await this.downloadFile(downloadUrl, zipPath);

            // Extract zip file
            await extract(zipPath, { dir: binDir });

            // Path to extracted flatc
            const flatcPath = path.join(binDir, flatcBin);

            // Make executable on Unix platforms
            if (platform !== 'win32') {
                fs.chmodSync(flatcPath, 0o755);
            }

            // Clean up zip file
            fs.unlinkSync(zipPath);

            // Verify it works
            try {
                await execFile(flatcPath, ['--version']);
            } catch (error) {
                const execError = error as Error;
                throw new Error(`Failed to run the downloaded flatc binary: ${execError.message}`);
            }

            this.flatcPath = flatcPath;
            vscode.window.showInformationMessage('FlatBuffers compiler downloaded successfully!');
            
            return flatcPath;
        } catch (err) {
            const error = err as Error;
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