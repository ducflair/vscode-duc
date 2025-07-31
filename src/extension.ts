import * as vscode from 'vscode';
import { DucViewerProvider } from './ducViewerEditor';
import { FlatcManager } from './flatcManager';
import { CustomSchemaManager } from './customSchemaManager';

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
}