import * as vscode from 'vscode';

export class DucPreviewManager {
	private static instance: DucPreviewManager;
	private readonly _previews = new Set<vscode.WebviewPanel>();

	private constructor(private readonly _context: vscode.ExtensionContext) { }

	public static getInstance(context: vscode.ExtensionContext): DucPreviewManager {
		if (!DucPreviewManager.instance) {
			DucPreviewManager.instance = new DucPreviewManager(context);
		}
		return DucPreviewManager.instance;
	}

	public async openPreview(uri: vscode.Uri) {
		// Create or show the webview panel
		const fileName = uri.path.split('/').pop() || 'Preview';
		const panel = vscode.window.createWebviewPanel(
			'duc.preview', // viewType
			`Preview: ${fileName}`,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'media')]
			}
		);

		this._previews.add(panel);

		// Cleanup when module is disposed
		panel.onDidDispose(() => {
			this._previews.delete(panel);
		});

		// Set HTML content
		panel.webview.html = this._getHtmlForWebview();

		// Handle messages from the webview
		panel.webview.onDidReceiveMessage(async (message) => {
			if (message.type === 'APP_READY') {
				await this._sendFileData(panel, uri);
			}
		});
	}

	private _getHtmlForWebview(): string {
		const targetUrl = 'https://scopture.com/preview';

		return `
            <!DOCTYPE html>
            <html lang="en" style="height: 100%">
            <head>
                <meta charset="UTF-8">
                <style>
                    body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; }
                    iframe { 
                        width: 125%; 
                        height: 125%; 
                        border: none; 
                        transform: scale(0.8); 
                        transform-origin: top left; 
                    }
                </style>
            </head>
            <body>
                <iframe src="${targetUrl}" id="app-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
                
                <script>
                    const vscode = acquireVsCodeApi();
                    const frame = document.getElementById('app-frame');

                    // Forward messages from VS Code Extension -> Iframe (React App)
                    window.addEventListener('message', event => {
                        // Ensure we are forwarding valid data to the iframe
                        if (frame && frame.contentWindow) {
                            frame.contentWindow.postMessage(event.data, '*');
                        }
                    });

                    // Forward messages from Iframe -> VS Code (e.g., "I'm ready")
                    window.addEventListener('message', event => {
                         // Check if origin matches to avoid processing our own messages if needed, 
                         // but for "APP_READY" usually checking data type is enough.
                         if (event.data && event.data.type === 'APP_READY') {
                             vscode.postMessage(event.data);
                         }
                    });
                </script>
            </body>
            </html>
        `;
	}

	private async _sendFileData(panel: vscode.WebviewPanel, uri: vscode.Uri) {
		try {
			const fileName = uri.path.split('/').pop() || 'file.duc';
			const fileData = await vscode.workspace.fs.readFile(uri);
			const base64 = Buffer.from(fileData).toString('base64');

			panel.webview.postMessage({
				type: 'FILE_DATA',
				name: fileName,
				data: base64
			});
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to read file: ${(error as Error).message}`);
		}
	}
}
