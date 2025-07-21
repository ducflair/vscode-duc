import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Manages custom FlatBuffers schema selection and storage
 */
export class CustomSchemaManager {
    private static instance: CustomSchemaManager;
    private context: vscode.ExtensionContext;
    private readonly CUSTOM_SCHEMA_KEY = 'ducPreview.customSchemaPath';

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public static getInstance(context: vscode.ExtensionContext): CustomSchemaManager {
        if (!CustomSchemaManager.instance) {
            CustomSchemaManager.instance = new CustomSchemaManager(context);
        }
        return CustomSchemaManager.instance;
    }

    /**
     * Get the current custom schema path if set and valid
     */
    public getCustomSchemaPath(): string | null {
        const workspaceConfig = vscode.workspace.getConfiguration('ducPreview');
        const customSchemaPath = workspaceConfig.get<string>('customSchemaPath');
        
        if (customSchemaPath && this.isValidSchemaFile(customSchemaPath)) {
            return customSchemaPath;
        }
        
        return null;
    }

    /**
     * Get the custom schema content if available and valid
     */
    public async getCustomSchemaContent(): Promise<string | null> {
        const schemaPath = this.getCustomSchemaPath();
        if (!schemaPath) {
            return null;
        }

        try {
            const content = await fs.promises.readFile(schemaPath, 'utf8');
            return content;
        } catch (error) {
            console.warn(`CustomSchemaManager: Failed to read custom schema at ${schemaPath}:`, error);
            // Clear invalid path
            await this.clearCustomSchema();
            return null;
        }
    }

    /**
     * Check if a file path points to a valid schema file
     */
    private isValidSchemaFile(filePath: string): boolean {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                return false;
            }

            // Check if it's a .fbs file
            if (!filePath.toLowerCase().endsWith('.fbs')) {
                return false;
            }

            // Check if it's readable
            fs.accessSync(filePath, fs.constants.R_OK);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Prompt user to select a custom schema file
     */
    public async selectCustomSchema(): Promise<void> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Select FlatBuffers Schema',
            filters: {
                'FlatBuffers Schema': ['fbs'],
                'All Files': ['*']
            }
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (!fileUri || fileUri.length === 0) {
            return; // User cancelled
        }

        const selectedPath = fileUri[0].fsPath;
        
        // Validate the selected file
        if (!this.isValidSchemaFile(selectedPath)) {
            vscode.window.showErrorMessage('Invalid schema file. Please select a valid .fbs file.');
            return;
        }

        // Save to workspace configuration (with fallback to user settings)
        const workspaceConfig = vscode.workspace.getConfiguration('ducPreview');
        try {
            // Try workspace settings first, fall back to global if no workspace
            const configTarget = vscode.workspace.workspaceFolders ? 
                vscode.ConfigurationTarget.Workspace : 
                vscode.ConfigurationTarget.Global;
                
            await workspaceConfig.update('customSchemaPath', selectedPath, configTarget);
            
            const relativePath = vscode.workspace.asRelativePath(selectedPath);
            const scope = configTarget === vscode.ConfigurationTarget.Workspace ? 'workspace' : 'user settings';
            vscode.window.showInformationMessage(`Custom schema set in ${scope}: ${relativePath}`);
            console.log(`CustomSchemaManager: Custom schema set to: ${selectedPath} (${scope})`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save custom schema path: ${(error as Error).message}`);
        }
    }

    /**
     * Clear the custom schema setting
     */
    public async clearCustomSchema(): Promise<void> {
        const workspaceConfig = vscode.workspace.getConfiguration('ducPreview');
        try {
            // Try workspace settings first, fall back to global if no workspace
            const configTarget = vscode.workspace.workspaceFolders ? 
                vscode.ConfigurationTarget.Workspace : 
                vscode.ConfigurationTarget.Global;
                
            await workspaceConfig.update('customSchemaPath', undefined, configTarget);
            const scope = configTarget === vscode.ConfigurationTarget.Workspace ? 'workspace' : 'user settings';
            vscode.window.showInformationMessage(`Custom schema cleared from ${scope}. Using default embedded schema.`);
            console.log(`CustomSchemaManager: Custom schema cleared (${scope})`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to clear custom schema: ${(error as Error).message}`);
        }
    }

    /**
     * Check if a custom schema is currently set
     */
    public hasCustomSchema(): boolean {
        return this.getCustomSchemaPath() !== null;
    }

    /**
     * Get a display name for the current schema (for UI purposes)
     */
    public getCurrentSchemaDisplayName(): string {
        const customPath = this.getCustomSchemaPath();
        if (customPath) {
            return `Custom: ${vscode.workspace.asRelativePath(customPath)}`;
        }
        return 'Default (Embedded)';
    }
}
