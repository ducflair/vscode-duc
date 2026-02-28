import * as vscode from 'vscode';
import { DucCompressedSqliteProvider } from './ducCompressedSqliteEditor';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(DucCompressedSqliteProvider.register());
}

export function deactivate() {
	// No-op.
}