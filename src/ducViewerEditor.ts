import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import * as util from 'util';
import * as https from 'https';
import * as fs from 'fs';
import { Disposable } from './dispose';
import { getNonce } from './util';
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
 * Define the document (the data model) used for duc files.
 */
class DucDocument extends Disposable implements vscode.CustomDocument {
    private flatcManager: FlatcManager;

    static async create(
        uri: vscode.Uri,
        backupId: string | undefined,
        context: vscode.ExtensionContext
    ): Promise<DucDocument | PromiseLike<DucDocument>> {
        // If we have a backup, read that. Otherwise read the resource from the workspace
        const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
        const fileData = await DucDocument.readFile(dataFile);
        return new DucDocument(uri, fileData, context);
    }

    private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (uri.scheme === 'untitled') {
            return new Uint8Array();
        }
        return new Uint8Array(await vscode.workspace.fs.readFile(uri));
    }

    private readonly _uri: vscode.Uri;
    private _documentData: Uint8Array;
    private _jsonContent = '';

    private constructor(
        uri: vscode.Uri,
        initialContent: Uint8Array,
        context: vscode.ExtensionContext
    ) {
        super();
        this._uri = uri;
        this._documentData = initialContent;
        this.flatcManager = FlatcManager.getInstance(context);
    }

    public get uri() { return this._uri; }
    public get documentData(): Uint8Array { return this._documentData; }

    private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
    /**
     * Fired when the document is disposed of.
     */
    public readonly onDidDispose = this._onDidDispose.event;

    /**
     * Called by VS Code when there are no more references to the document.
     *
     * This happens when all editors for it have been closed.
     */
    dispose(): void {
        this._onDidDispose.fire();
        super.dispose();
    }

    /**
     * Convert the binary data to JSON using flatbuffers
     */
    async getJSON(): Promise<string> {
        if (this._jsonContent) {
            return this._jsonContent;
        }

        try {
            const tempDir = os.tmpdir();
            
            // Add logging to track progress
            console.log('DUC Viewer: Starting conversion to JSON');
            
            // Download the schema file
            const schemaPath = path.join(tempDir, `duc_schema_${Date.now()}.fbs`);
            console.log(`DUC Viewer: Downloading schema file to ${schemaPath}`);
            try {
                await downloadFile(fbsUrl, schemaPath);
                console.log('DUC Viewer: Schema file downloaded successfully');
            } catch (error) {
                const downloadError = error as Error;
                console.error(`DUC Viewer: Failed to download schema file: ${downloadError.message}`);
                throw new Error(`Failed to download schema file: ${downloadError.message}`);
            }
            
            // Create a temp file for the binary data
            const tempPath = path.join(tempDir, `duc_temp_${Date.now()}.duc`);
            const fsPath = vscode.Uri.file(tempPath);
            console.log(`DUC Viewer: Writing binary data to ${tempPath}`);
            
            // Write the binary data to the temp file
            try {
                await vscode.workspace.fs.writeFile(fsPath, this._documentData);
                console.log('DUC Viewer: Binary data written successfully');
            } catch (error) {
                const writeError = error as Error;
                console.error(`DUC Viewer: Failed to write temporary file: ${writeError.message}`);
                try { fs.unlinkSync(schemaPath); } catch (_) { /* ignore */ }
                throw new Error(`Failed to write temporary file: ${writeError.message}`);
            }

            // Get the path to flatc (will download if needed)
            console.log('DUC Viewer: Getting flatc path');
            let flatcPath;
            try {
                flatcPath = await this.flatcManager.getFlatcPath();
                console.log(`DUC Viewer: Using flatc at ${flatcPath}`);
            } catch (error) {
                const flatcError = error as Error;
                console.error(`DUC Viewer: Failed to get flatc: ${flatcError.message}`);
                try { fs.unlinkSync(schemaPath); } catch (_) { /* ignore */ }
                try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
                throw new Error(`Failed to get flatc: ${flatcError.message}`);
            }

            // Execute flatc to convert binary to JSON
            console.log('DUC Viewer: Executing flatc to convert binary to JSON');
            try {
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
                console.log('DUC Viewer: flatc conversion completed');
                if (result.stderr) {
                    console.log(`DUC Viewer: flatc stderr: ${result.stderr}`);
                }
            } catch (error) {
                const flatcError = error as { code?: string, message: string, stderr?: string };
                console.error(`DUC Viewer: flatc conversion failed: ${flatcError.message}\n${flatcError.stderr || ''}`);
                try { fs.unlinkSync(schemaPath); } catch (_) { /* ignore */ }
                try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
                
                throw new Error(`flatc conversion failed: ${flatcError.message}\n${flatcError.stderr || ''}`);
            }

            // Read the JSON file that was created by flatc
            const jsonFilePath = path.join(tempDir, path.basename(tempPath, '.duc') + '.json');
            console.log(`DUC Viewer: Reading JSON from ${jsonFilePath}`);
            let tempFileDeleted = false;
            let jsonFileDeleted = false;

            try {
                const jsonUri = vscode.Uri.file(jsonFilePath);
                const jsonData = await vscode.workspace.fs.readFile(jsonUri);
                if (!jsonData || jsonData.length === 0) {
                    console.error('DUC Viewer: JSON data is empty');
                    throw new Error('Generated JSON file is empty');
                }
                
                this._jsonContent = new TextDecoder().decode(jsonData);
                console.log('DUC Viewer: JSON conversion successful');
                
                // Clean up temp files
                try { 
                    await vscode.workspace.fs.delete(fsPath); 
                    tempFileDeleted = true;
                    console.log('DUC Viewer: Deleted temp file');
                } catch (e) { 
                    console.error(`DUC Viewer: Failed to delete temp file: ${e}`); 
                }
                
                try { 
                    await vscode.workspace.fs.delete(jsonUri); 
                    jsonFileDeleted = true;
                    console.log('DUC Viewer: Deleted JSON file');
                } catch (e) { 
                    console.error(`DUC Viewer: Failed to delete JSON file: ${e}`); 
                }
            } catch (error) {
                const readError = error as Error;
                console.error(`DUC Viewer: Failed to read generated JSON file: ${readError.message}`);
                throw new Error(`Failed to read generated JSON file: ${readError.message}`);
            } finally {
                // Ensure we clean up the schema file
                try { fs.unlinkSync(schemaPath); } catch (e: any) { 
                    if (!e.message.includes('ENOENT')) {
                        console.error(`DUC Viewer: Failed to delete schema file: ${e}`); 
                    }
                }
                
                // Only attempt to delete if not already deleted
                if (!tempFileDeleted) {
                    try { fs.unlinkSync(tempPath); } catch (e: any) { 
                        if (!e.message.includes('ENOENT')) {
                            console.error(`DUC Viewer: Failed to delete temp file: ${e}`); 
                        }
                    }
                }
                
                if (!jsonFileDeleted) {
                    try { fs.unlinkSync(jsonFilePath); } catch (e: any) { 
                        if (!e.message.includes('ENOENT')) {
                            console.error(`DUC Viewer: Failed to delete JSON file: ${e}`); 
                        }
                    }
                }
            }
            
            return this._jsonContent;
        } catch (err) {
            const error = err as Error;
            const errorMessage = `Error converting DUC file to JSON: ${error.message}`;
            console.error(`DUC Viewer: ${errorMessage}`);
            vscode.window.showErrorMessage(errorMessage);
            
            return JSON.stringify({ 
                error: errorMessage
            }, null, 2);
        }
    }

    /**
     * Called to revert the document to its original state
     */
    async revert(_cancellation: vscode.CancellationToken): Promise<void> {
        const diskContent = await DucDocument.readFile(this._uri);
        this._documentData = diskContent;
        this._jsonContent = ''; // Clear cached JSON so it will be regenerated
    }

    /**
     * Called to back up the document in case of auto save
     */
    async backup(destination: vscode.Uri, _cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        await this.saveAs(destination, _cancellation);

        return {
            id: destination.toString(),
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(destination);
                } catch {
                    // noop
                }
            }
        };
    }

    /**
     * Save the document to disk
     */
    async saveAs(targetResource: vscode.Uri, _cancellation: vscode.CancellationToken): Promise<void> {
        await vscode.workspace.fs.writeFile(targetResource, this._documentData);
    }
}

/**
 * Provider for Duc viewers.
 */
export class DucViewerProvider implements vscode.CustomReadonlyEditorProvider<DucDocument> {
    private flatcManager: FlatcManager;

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            DucViewerProvider.viewType,
            new DucViewerProvider(context),
            {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: {
                    retainContextWhenHidden: true,
                }
            }
        );
    }

    private static readonly viewType = 'ducPreview.ducViewer';

    constructor(
        private readonly _context: vscode.ExtensionContext
    ) {
        this.flatcManager = FlatcManager.getInstance(_context);
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: { backupId?: string },
        _token: vscode.CancellationToken
    ): Promise<DucDocument> {
        const document = await DucDocument.create(uri, openContext.backupId, this._context);
        return document;
    }

    async resolveCustomEditor(
        document: DucDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Set up the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Add event listener for messages from the webview
        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'ready':
                    // When the webview is ready, send the JSON content
                    this.sendJsonToWebview(document, webviewPanel);
                    break;
            }
        });

        // If the document changes or the panel becomes visible again, update the content
        webviewPanel.onDidChangeViewState(e => {
            if (e.webviewPanel.visible) {
                this.sendJsonToWebview(document, webviewPanel);
            }
        });
    }

    private async sendJsonToWebview(document: DucDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        try {
            console.log('DUC Viewer: Sending JSON to webview');
            webviewPanel.webview.postMessage({
                type: 'update',
                content: JSON.stringify({ 
                    loading: true,
                    message: 'Converting DUC file to JSON...'
                })
            });
            
            const jsonContent = await document.getJSON();
            
            // Check if JSON content is valid
            try {
                JSON.parse(jsonContent);
            } catch (parseError) {
                console.error(`DUC Viewer: Invalid JSON content: ${parseError}`);
                webviewPanel.webview.postMessage({
                    type: 'error',
                    message: `Failed to parse JSON: ${parseError}`
                });
                return;
            }
            
            webviewPanel.webview.postMessage({
                type: 'update',
                content: jsonContent
            });
            console.log('DUC Viewer: JSON sent to webview successfully');
        } catch (error) {
            const err = error as Error;
            console.error(`DUC Viewer: Error sending JSON to webview: ${err.message}`);
            webviewPanel.webview.postMessage({
                type: 'error',
                message: `Error: ${err.message}`
            });
        }
    }

    private getHtmlForWebview(_webview: vscode.Webview): string {
        // Use a nonce to whitelist which scripts can be run
        const nonce = getNonce();

        return /* html */`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
    <title>DUC Viewer</title>
    <style nonce="${nonce}">
        body {
            padding: 0;
            margin: 0;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        #json-container {
            padding: 10px;
            white-space: pre;
            word-wrap: break-word;
            font-family: monospace;
        }
        .string { color: var(--vscode-debugTokenExpression-string); }
        .number { color: var(--vscode-debugTokenExpression-number); }
        .boolean { color: var(--vscode-debugTokenExpression-boolean); }
        .null { color: var(--vscode-debugConsole-warningForeground); }
        .key { color: var(--vscode-symbolIcon-propertyForeground); }
        .error {
            color: var(--vscode-errorForeground);
            padding: 10px;
            border: 1px solid var(--vscode-errorForeground);
            margin-bottom: 10px;
            background-color: var(--vscode-inputValidation-errorBackground);
        }
        .loading {
            padding: 20px;
            text-align: center;
            font-style: italic;
            color: var(--vscode-descriptionForeground);
        }
        .loading-spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: var(--vscode-progressBar-background);
            animation: spin 1s ease-in-out infinite;
            margin-right: 10px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div id="json-container">
        <div class="loading">
            <div class="loading-spinner"></div>
            Loading DUC file content...
        </div>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        // Syntax highlighting function for JSON
        function syntaxHighlight(json) {
            if (typeof json !== 'string') {
                json = JSON.stringify(json, null, 2);
            }
            json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g, function (match) {
                let cls = 'number';
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'key';
                    } else {
                        cls = 'string';
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'boolean';
                } else if (/null/.test(match)) {
                    cls = 'null';
                }
                return '<span class="' + cls + '">' + match + '</span>';
            });
        }
        
        // Handle messages sent from the extension to the webview
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    try {
                        const jsonObj = JSON.parse(message.content);
                        
                        // Check if this is a loading state
                        if (jsonObj.loading === true) {
                            document.getElementById('json-container').innerHTML = 
                                '<div class="loading">' +
                                '<div class="loading-spinner"></div>' +
                                (jsonObj.message || 'Loading DUC file content...') +
                                '</div>';
                            return;
                        }
                        
                        // Check if there's an error in the JSON
                        if (jsonObj.error) {
                            document.getElementById('json-container').innerHTML = 
                                '<div class="error">' + jsonObj.error + '</div>';
                            console.error("DUC Viewer error:", jsonObj.error);
                            return;
                        }
                        
                        document.getElementById('json-container').innerHTML = syntaxHighlight(jsonObj);
                    } catch (error) {
                        document.getElementById('json-container').innerHTML = 
                            '<div class="error">Error parsing JSON: ' + error + '</div>' +
                            '<pre>' + message.content + '</pre>';
                        console.error("DUC Viewer JSON parse error:", error, message.content);
                    }
                    break;
                case 'error':
                    document.getElementById('json-container').innerHTML = 
                        '<div class="error">' + message.message + '</div>';
                    console.error("DUC Viewer received error:", message.message);
                    break;
            }
        });
        
        // Tell the extension that the webview is ready
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }
} 