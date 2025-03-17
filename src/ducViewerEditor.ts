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
            
            // Download the schema file
            const schemaPath = path.join(tempDir, `duc_schema_${Date.now()}.fbs`);
            try {
                await downloadFile(fbsUrl, schemaPath);
            } catch (error) {
                const downloadError = error as Error;
                throw new Error(`Failed to download schema file: ${downloadError.message}`);
            }
            
            // Create a temp file for the binary data
            const tempPath = path.join(tempDir, `duc_temp_${Date.now()}.duc`);
            const fsPath = vscode.Uri.file(tempPath);
            
            // Write the binary data to the temp file
            try {
                await vscode.workspace.fs.writeFile(fsPath, this._documentData);
            } catch (error) {
                const writeError = error as Error;
                fs.unlinkSync(schemaPath);
                throw new Error(`Failed to write temporary file: ${writeError.message}`);
            }

            // Get the path to flatc (will download if needed)
            const flatcPath = await this.flatcManager.getFlatcPath();

            // Execute flatc to convert binary to JSON
            try {
                await execFile(flatcPath, [
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
            } catch (error) {
                const flatcError = error as { code?: string, message: string, stderr?: string };
                fs.unlinkSync(schemaPath);
                try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
                
                throw new Error(`flatc conversion failed: ${flatcError.message}\n${flatcError.stderr || ''}`);
            }

            // Read the JSON file that was created by flatc
            const jsonFilePath = path.join(tempDir, path.basename(tempPath, '.duc') + '.json');
            let jsonData;
            try {
                const jsonUri = vscode.Uri.file(jsonFilePath);
                jsonData = await vscode.workspace.fs.readFile(jsonUri);
                this._jsonContent = new TextDecoder().decode(jsonData);
                
                // Clean up temp files
                await vscode.workspace.fs.delete(fsPath);
                await vscode.workspace.fs.delete(jsonUri);
            } catch (error) {
                const readError = error as Error;
                throw new Error(`Failed to read generated JSON file: ${readError.message}`);
            } finally {
                // Ensure we clean up the schema file
                fs.unlinkSync(schemaPath);
                try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
                try { fs.unlinkSync(jsonFilePath); } catch (_) { /* ignore */ }
            }
            
            return this._jsonContent;
        } catch (err) {
            const error = err as Error;
            const errorMessage = `Error converting DUC file to JSON: ${error.message}`;
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
            const jsonContent = await document.getJSON();
            webviewPanel.webview.postMessage({
                type: 'update',
                content: jsonContent
            });
        } catch (error) {
            const err = error as Error;
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
        }
    </style>
</head>
<body>
    <div id="json-container"></div>
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
                        document.getElementById('json-container').innerHTML = syntaxHighlight(jsonObj);
                    } catch (error) {
                        document.getElementById('json-container').innerHTML = 
                            '<div class="error">Error parsing JSON: ' + error + '</div>' +
                            '<pre>' + message.content + '</pre>';
                    }
                    break;
                case 'error':
                    document.getElementById('json-container').innerHTML = 
                        '<div class="error">' + message.message + '</div>';
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