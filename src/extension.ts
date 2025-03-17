import * as vscode from 'vscode';
import { DucViewerProvider } from './ducViewerEditor';
import { FlatcManager } from './flatcManager';

export function activate(context: vscode.ExtensionContext) {
	// Initialize the flatc manager
	const flatcManager = FlatcManager.getInstance(context);
	
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
}
