import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import { FlatcManager } from './flatcManager';
import { DUC_SCHEMA } from './assets/schema';

const execFile = util.promisify(childProcess.execFile);

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
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Processing DUC File",
            cancellable: false // Consider cancellable if feasible later
        }, async (progress) => {
            progress.report({ message: "Starting conversion..." });
            return this.convertDucToJson(this._fileData, progress);
        });
    }
    
    dispose(): void {
        // Nothing to dispose
    }
    
    /**
     * Convert DUC binary file to JSON using flatbuffers
     */
    private async convertDucToJson(fileData: Uint8Array, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<string> {
        try {
            const tempDir = os.tmpdir();
            console.debug('DUC Viewer: Starting conversion to JSON');
            
            progress.report({ message: "Preparing DUC schema..." });
            const schemaPath = path.join(tempDir, `duc_schema_${Date.now()}.fbs`);
            
            // Write the embedded schema to a temporary file
            fs.writeFileSync(schemaPath, DUC_SCHEMA, 'utf8');
            console.debug('DUC Viewer: Schema prepared from embedded content.');

            progress.report({ message: "Preparing binary data..." });
            const tempPath = path.join(tempDir, `duc_temp_${Date.now()}.duc`);
            fs.writeFileSync(tempPath, fileData);
            console.debug('DUC Viewer: Binary data prepared.');
            
            progress.report({ message: "Locating flatc compiler..." });
            const flatcPath = await this._flatcManager.getFlatcPath(); // This might trigger FlatcManager's own progress
            console.debug(`DUC Viewer: flatc path: ${flatcPath}`);

            progress.report({ message: "Executing flatc for JSON conversion..." });
            console.debug('DUC Viewer: Executing flatc...');
            // Execute flatc to convert binary to JSON
            await execFile(flatcPath, [
                '--json',
                '--strict-json',
                '--allow-non-utf8',
                '--raw-binary',
                '--no-warnings',
                // '--defaults-json',
                '-o', tempDir,
                schemaPath,
                '--',
                tempPath
            ]);
            console.debug('DUC Viewer: flatc execution complete.');
            
            progress.report({ message: "Reading converted JSON output..." });
            const jsonFilePath = path.join(tempDir, path.basename(tempPath, '.duc') + '.json');
            const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
            console.debug('DUC Viewer: JSON content read.');
            
            progress.report({ message: "Cleaning up temporary files..." });
            try { fs.unlinkSync(schemaPath); } catch (e: unknown) { console.warn('DUC Viewer: Failed to delete temp schema', (e as Error).message); }
            try { fs.unlinkSync(tempPath); } catch (e: unknown) { console.warn('DUC Viewer: Failed to delete temp duc file', (e as Error).message); }
            try { fs.unlinkSync(jsonFilePath); } catch (e: unknown) { console.warn('DUC Viewer: Failed to delete temp json file', (e as Error).message); }
            console.debug('DUC Viewer: Temporary files cleaned up.');
            
            progress.report({ message: "Finalizing JSON..." });

            const parsedJson = JSON.parse(jsonContent);
            if (parsedJson && parsedJson.files && Array.isArray(parsedJson.files.entries)) {
                for (const entry of parsedJson.files.entries) {
                    if (entry.value && entry.value.data) {
                        const binaryData = new Uint8Array(entry.value.data);
                        entry.value.data = binaryData.toString();
                    }
                }
            }

            return JSON.stringify(parsedJson, null, 2);
        } catch (execError: unknown) {
            // Cast to the expected error structure from child_process.execFile
            const error = execError as Error & { stderr?: Buffer | string, stdout?: Buffer | string, code?: number, signal?: string };
            
            // Default base message from the execFile error, typically includes the command
            let detailedMessage = (error && typeof error.message === 'string') 
                                ? error.message 
                                : 'Failed to execute flatc command.';

            // Log the raw error object for extension developer's debugging console
            console.error('DUC Viewer: Raw error object from flatc execution:', execError);
            if (execError && typeof execError === 'object') {
                console.error('DUC Viewer: Keys of raw error object:', Object.keys(execError));
            }

            // Append Stderr information
            if (error && typeof error.stderr !== 'undefined') {
                const stderrStr = Buffer.isBuffer(error.stderr) ? error.stderr.toString().trim() : String(error.stderr).trim();
                detailedMessage += `\n\nStderr from flatc:\n${stderrStr.length > 0 ? stderrStr : '(empty)'}`;
            } else {
                detailedMessage += '\n\nStderr from flatc: (not available on error object)';
            }

            // Append Stdout information
            if (error && typeof error.stdout !== 'undefined') {
                const stdoutStr = Buffer.isBuffer(error.stdout) ? error.stdout.toString().trim() : String(error.stdout).trim();
                detailedMessage += `\n\nStdout from flatc:\n${stdoutStr.length > 0 ? stdoutStr : '(empty)'}`;
            } else {
                detailedMessage += '\n\nStdout from flatc: (not available on error object)';
            }
            
            // Append exit code if available
            if (error && typeof error.code === 'number') {
                detailedMessage += `\n\nExit code: ${error.code}`;
            } else if (error && typeof error.code !== 'undefined') {
                 detailedMessage += `\n\nExit code: ${error.code} (type: ${typeof error.code})`;
            }

            // Append signal if available
            if (error && typeof error.signal === 'string') {
                detailedMessage += `\n\nSignal: ${error.signal}`;
            } else if (error && typeof error.signal !== 'undefined') {
                 detailedMessage += `\n\nSignal: ${error.signal} (type: ${typeof error.signal})`;
            }
            
            throw new Error(detailedMessage);
        }
    }
}
