import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import { FlatcManager } from './flatcManager';

const execFile = util.promisify(childProcess.execFile);
const fbsUrl = 'https://raw.githubusercontent.com/ducflair/duc/refs/heads/main/packages/core/canvas/duc/duc.fbs';

/**
 * Download a file from a URL to a local file
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
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

/**
 * Provider for DUC file editor
 */
export class DucViewerProvider implements vscode.CustomReadonlyEditorProvider<DucDocument> {
    private flatcManager: FlatcManager;

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            'ducPreview.ducViewer',
            new DucViewerProvider(context),
            {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: { retainContextWhenHidden: true }
            }
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {
        this.flatcManager = FlatcManager.getInstance(context);
    }

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<DucDocument> {
        const fileData = await vscode.workspace.fs.readFile(uri);
        return new DucDocument(uri, fileData, this.context);
    }

    async resolveCustomEditor(
        document: DucDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Set up the webview
        webviewPanel.webview.options = {
            enableScripts: true
        };
        
        // Set initial HTML content with loading message
        webviewPanel.webview.html = this.getLoadingHtml();
        
        try {
            // Convert to JSON
            const jsonData = await document.getJsonContent();
            
            // Update webview with Monaco editor displaying the JSON
            webviewPanel.webview.html = this.getMonacoEditorHtml(webviewPanel.webview, jsonData);
        } catch (error) {
            const errorMessage = `Error processing DUC file: ${(error as Error).message}`;
            console.error(errorMessage);
            webviewPanel.webview.html = this.getErrorHtml(errorMessage);
        }
    }

    private getLoadingHtml(): string {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                }
                .loading {
                    text-align: center;
                }
                .spinner {
                    width: 50px;
                    height: 50px;
                    border: 5px solid var(--vscode-progressBar-background);
                    border-radius: 50%;
                    border-top-color: transparent;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 20px;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            </style>
        </head>
        <body>
            <div class="loading">
                <div class="spinner"></div>
                <div>Converting DUC file to JSON...</div>
            </div>
        </body>
        </html>`;
    }

    private getErrorHtml(message: string): string {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                }
                .error {
                    text-align: center;
                    color: var(--vscode-errorForeground);
                    border: 1px solid var(--vscode-errorForeground);
                    padding: 20px;
                    border-radius: 5px;
                    max-width: 80%;
                }
            </style>
        </head>
        <body>
            <div class="error">${message}</div>
        </body>
        </html>`;
    }

    private getMonacoEditorHtml(webview: vscode.Webview, jsonData: string): string {
        // Get a reference to the VS Code webview origin
        const cspSource = webview.cspSource;
        
        // Create a URI to the monaco editor resources
        const monacoBase = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'node_modules', 'monaco-editor', 'min'
        ));

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="
                default-src 'none';
                style-src ${cspSource} 'unsafe-inline';
                script-src ${cspSource} 'unsafe-inline';
                font-src ${cspSource};
                worker-src blob:;
                connect-src ${cspSource} https:;
                img-src ${cspSource} data:
            ">
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100vh;
                    overflow: hidden;
                }
                #editor {
                    width: 100%;
                    height: 100%;
                }
            </style>
        </head>
        <body>
            <div id="editor"></div>
            
            <script src="${monacoBase}/vs/loader.js"></script>
            <script>
                // Configure loader to use monaco
                require.config({ paths: { vs: '${monacoBase}/vs' } });
                
                // Load the editor
                require(['vs/editor/editor.main'], function() {
                    // Determine the current theme
                    const currentTheme = document.body.classList.contains('vscode-dark') ? 'vs-dark' : 
                                       document.body.classList.contains('vscode-high-contrast') ? 'hc-black' : 'vs';
                    monaco.editor.setTheme(currentTheme);
                    
                    // Create the editor
                    const editor = monaco.editor.create(document.getElementById('editor'), {
                        value: ${JSON.stringify(jsonData)},
                        language: 'json',
                        readOnly: true,
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                        minimap: { enabled: true },
                        formatOnPaste: true,
                        formatOnType: true,
                        renderIndentGuides: true
                    });
                    
                    // Format the document when editor is loaded
                    setTimeout(() => {
                        editor.getAction('editor.action.formatDocument').run();
                    }, 100);
                    
                    // Handle window resize
                    window.addEventListener('resize', function() {
                        editor.layout();
                    });
                });
            </script>
        </body>
        </html>`;
    }
}

/**
 * Class representing a DUC document
 */
class DucDocument implements vscode.CustomDocument {
    private _flatcManager: FlatcManager;
    
    constructor(
        private _uri: vscode.Uri,
        private _fileData: Uint8Array,
        private _context: vscode.ExtensionContext
    ) {
        this._flatcManager = FlatcManager.getInstance(_context);
    }

    public get uri() { return this._uri; }
    
    public async getJsonContent(): Promise<string> {
        return this.convertDucToJson(this._fileData);
    }
    
    dispose(): void {
        // Nothing to dispose
    }
    
    /**
     * Convert DUC binary file to JSON using flatbuffers
     */
    private async convertDucToJson(fileData: Uint8Array): Promise<string> {
        try {
            const tempDir = os.tmpdir();
            console.debug('DUC Viewer: Starting conversion to JSON');
            
            // Download the schema file
            const schemaPath = path.join(tempDir, `duc_schema_${Date.now()}.fbs`);
            await downloadFile(fbsUrl, schemaPath);
            
            // Create a temp file for the binary data
            const tempPath = path.join(tempDir, `duc_temp_${Date.now()}.duc`);
            fs.writeFileSync(tempPath, fileData);
            
            // Get flatc path
            const flatcPath = await this._flatcManager.getFlatcPath();
            
            // Execute flatc to convert binary to JSON
            const result = await execFile(flatcPath, [
                '--json',
                '--strict-json',
                '--raw-binary',
                '--no-warnings',
                '--defaults-json',
                '-o', tempDir,
                schemaPath,
                '--',
                tempPath
            ]);
            
            // Read the JSON file created by flatc
            const jsonFilePath = path.join(tempDir, path.basename(tempPath, '.duc') + '.json');
            const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
            
            // Clean up temp files
            try { fs.unlinkSync(schemaPath); } catch (_) { /* ignore */ }
            try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
            try { fs.unlinkSync(jsonFilePath); } catch (_) { /* ignore */ }
            
            // Parse and format the JSON to ensure it's valid and properly formatted
            return JSON.stringify(JSON.parse(jsonContent), null, 2);
        } catch (error) {
            console.error('DUC Viewer: Error in convertDucToJson', error);
            throw error;
        }
    }
}
