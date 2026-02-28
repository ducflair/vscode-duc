import { promisify } from 'util';
import * as vscode from 'vscode';
import * as zlib from 'zlib';

const inflateAsync = promisify(zlib.inflate);
const inflateRawAsync = promisify(zlib.inflateRaw);
const gunzipAsync = promisify(zlib.gunzip);

const DUC_VIEW_TYPE = 'ducPreview.ducViewer';
const SQLITE_VIEW_TYPE = 'sqlite-viewer.view';
const DUC_SCHEME = 'duc-sqlite';

// ---------------------------------------------------------------------------
// Virtual read-only filesystem that serves decompressed SQLite bytes
// ---------------------------------------------------------------------------

class DucSqliteFs implements vscode.FileSystemProvider {
	private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this._onDidChangeFile.event;

	private readonly _cache = new Map<string, Uint8Array>();

	cache(uri: vscode.Uri, data: Uint8Array): void {
		this._cache.set(uri.toString(), data);
	}

	watch(): vscode.Disposable {
		return new vscode.Disposable(() => { /* noop */ });
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const fileUri = uri.with({ scheme: 'file' });
		const stat = await vscode.workspace.fs.stat(fileUri);
		return {
			type: stat.type,
			ctime: stat.ctime,
			mtime: stat.mtime,
			size: stat.size,
			permissions: vscode.FilePermission.Readonly,
		};
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const key = uri.toString();
		const cached = this._cache.get(key);
		if (cached) {
			this._cache.delete(key);
			return cached;
		}

		const fileUri = uri.with({ scheme: 'file' });
		const raw = await vscode.workspace.fs.readFile(fileUri);
		return new Uint8Array(await extractSqlitePayload(Buffer.from(raw)));
	}

	readDirectory(): Thenable<[string, vscode.FileType][]> {
		throw vscode.FileSystemError.NoPermissions('Read-only');
	}
	createDirectory(): void {
		throw vscode.FileSystemError.NoPermissions('Read-only');
	}
	writeFile(): void {
		throw vscode.FileSystemError.NoPermissions('Read-only');
	}
	delete(): void {
		throw vscode.FileSystemError.NoPermissions('Read-only');
	}
	rename(): void {
		throw vscode.FileSystemError.NoPermissions('Read-only');
	}
}

// ---------------------------------------------------------------------------
// Decompression helpers
// ---------------------------------------------------------------------------

async function extractSqlitePayload(buffer: Buffer): Promise<Buffer> {
	if (isSqliteDatabase(buffer)) {
		return buffer;
	}

	const strategies: Array<() => Promise<Buffer>> = [
		() => inflateAsync(buffer),
		() => inflateRawAsync(buffer),
		() => gunzipAsync(buffer),
	];

	for (const decompress of strategies) {
		try {
			const result = await decompress();
			if (isSqliteDatabase(result)) {
				return result;
			}
		} catch {
			// Try next strategy.
		}
	}

	throw new Error(
		'The .duc file is neither a plain SQLite database nor a recognised compressed SQLite payload.',
	);
}

function isSqliteDatabase(buffer: Buffer): boolean {
	const header = 'SQLite format 3\0';
	return buffer.length >= header.length
		&& buffer.subarray(0, header.length).toString('utf8') === header;
}

// ---------------------------------------------------------------------------
// Custom editor – intercepts .duc, decompresses, hands off to SQLite Viewer
// ---------------------------------------------------------------------------

class DucDocument implements vscode.CustomDocument {
	constructor(public readonly uri: vscode.Uri) { }
	dispose(): void { }
}

export class DucCompressedSqliteProvider implements vscode.CustomReadonlyEditorProvider<DucDocument> {

	public static register(): vscode.Disposable {
		const fs = new DucSqliteFs();
		const provider = new DucCompressedSqliteProvider(fs);

		return vscode.Disposable.from(
			vscode.workspace.registerFileSystemProvider(DUC_SCHEME, fs, { isReadonly: true }),
			vscode.window.registerCustomEditorProvider(DUC_VIEW_TYPE, provider, {
				supportsMultipleEditorsPerDocument: false,
			}),
		);
	}

	private constructor(private readonly _fs: DucSqliteFs) { }

	public async openCustomDocument(
		uri: vscode.Uri,
		_openContext: vscode.CustomDocumentOpenContext,
		_token: vscode.CancellationToken,
	): Promise<DucDocument> {
		return new DucDocument(uri);
	}

	public async resolveCustomEditor(
		document: DucDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		webviewPanel.webview.html = this.getLoadingHtml();

		try {
			const raw = await vscode.workspace.fs.readFile(document.uri);
			const sqlite = await extractSqlitePayload(Buffer.from(raw));

			const virtualUri = document.uri.with({ scheme: DUC_SCHEME });
			this._fs.cache(virtualUri, new Uint8Array(sqlite));

			await vscode.commands.executeCommand(
				'vscode.openWith',
				virtualUri,
				SQLITE_VIEW_TYPE,
				webviewPanel.viewColumn,
			);
			webviewPanel.dispose();
		} catch (error) {
			webviewPanel.webview.html = this.getErrorHtml((error as Error).message);
		}
	}

	private getLoadingHtml(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			display: flex;
			align-items: center;
			justify-content: center;
			height: 100vh;
			margin: 0;
		}
	</style>
</head>
<body>
	<div>Decompressing DUC database…</div>
</body>
</html>`;
	}

	private getErrorHtml(message: string): string {
		const escaped = message
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-errorForeground);
			background: var(--vscode-editor-background);
			display: flex;
			align-items: center;
			justify-content: center;
			height: 100vh;
			margin: 0;
			padding: 24px;
		}
		.container {
			max-width: 720px;
			border: 1px solid var(--vscode-errorForeground);
			padding: 16px;
			border-radius: 6px;
		}
	</style>
</head>
<body>
	<div class="container">
		<strong>Could not open .duc file</strong>
		<div>${escaped}</div>
	</div>
</body>
</html>`;
	}
}
