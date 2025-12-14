import * as vscode from 'vscode';
import { DucViewerProvider } from './ducViewerEditor';
import { FlatcManager } from './flatcManager';
import { CustomSchemaManager } from './customSchemaManager';
import { DucPreviewManager } from './ducPreviewManager';

export function activate(context: vscode.ExtensionContext) {
	// Initialize managers
	const flatcManager = FlatcManager.getInstance(context);
	const customSchemaManager = CustomSchemaManager.getInstance(context);

	// Register our custom editor provider
	context.subscriptions.push(DucViewerProvider.register(context));

	// Register command to check for flatc
	context.subscriptions.push(
		vscode.commands.registerCommand('ducPreview.checkFlatc', async () => {
			try {
				const flatcPath = await flatcManager.getFlatcPath();
				vscode.window.showInformationMessage(`FlatBuffers compiler (flatc) is available at: ${flatcPath}`);
			} catch (err) {
				const error = err as Error;
				vscode.window.showErrorMessage(`FlatBuffers compiler (flatc) is not available: ${error.message}`);
			}
		})
	);

	// Register command to select custom schema
	context.subscriptions.push(
		vscode.commands.registerCommand('ducPreview.selectCustomSchema', async () => {
			await customSchemaManager.selectCustomSchema();
		})
	);

	// Register command to clear custom schema
	context.subscriptions.push(
		vscode.commands.registerCommand('ducPreview.clearCustomSchema', async () => {
			await customSchemaManager.clearCustomSchema();
		})
	);

	// Register command to open webview preview
	const ducPreviewManager = DucPreviewManager.getInstance(context);
	context.subscriptions.push(
		vscode.commands.registerCommand('ducPreview.openWebviewPreview', async (uri: vscode.Uri) => {
			// If uri is undefined (e.g. invoked from command palette without context), we can't easily get the active custom editor in stable API
			// So we rely on the uri passed by the menu contribution
			const targetUri = uri;

			if (targetUri) {
				await ducPreviewManager.openPreview(targetUri);
			} else {
				vscode.window.showErrorMessage('No DUC file selected to preview.');
			}
		})
	);
}