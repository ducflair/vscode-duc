import * as fs from 'fs';

/**
 * Parses FlatBuffers schema files to detect byte array fields
 */
export class SchemaParser {
    private static instance: SchemaParser;
    private byteArrayFields: Set<string> = new Set();
    private schemaContent: string = '';

    private constructor() {}

    public static getInstance(): SchemaParser {
        if (!SchemaParser.instance) {
            SchemaParser.instance = new SchemaParser();
        }
        return SchemaParser.instance;
    }

    /**
     * Parse a FlatBuffers schema file to detect byte array fields
     */
    public parseSchema(schemaContent: string): Set<string> {
        this.schemaContent = schemaContent;
        this.byteArrayFields.clear();

        console.debug('SchemaParser: Starting schema parsing...');
        
        // Split into lines and parse each line
        const lines = schemaContent.split('\n');
        
        for (const line of lines) {
            this.parseLine(line.trim());
        }

        // Add known binary data fields from DUC schema
        this.addKnownBinaryFields();

        console.debug('SchemaParser: Detected byte array fields:', Array.from(this.byteArrayFields));
        return this.byteArrayFields;
    }

    /**
     * Parse a single line to detect byte array field declarations
     */
    private parseLine(line: string): void {
        // Skip comments and empty lines
        if (line.startsWith('//') || line.startsWith('#') || line.length === 0) {
            return;
        }

        // Look for field declarations with byte arrays
        // Pattern: field_name: [byte] or field_name: [ubyte]
        const byteArrayPattern = /^\s*(\w+)\s*:\s*\[(?:u?)byte\]\s*(?:;|$)/;
        const match = line.match(byteArrayPattern);
        
        if (match) {
            const fieldName = match[1];
            this.byteArrayFields.add(fieldName);
            console.debug(`SchemaParser: Detected byte array field: ${fieldName}`);
        }

        // Also look for nested table fields that might contain byte arrays
        // Pattern: field_name: TableName
        const tableFieldPattern = /^\s*(\w+)\s*:\s*(\w+)(?:\s*;|\s*$)/;
        const tableMatch = line.match(tableFieldPattern);
        
        if (tableMatch) {
            const fieldName = tableMatch[1];
            const tableName = tableMatch[2];
            
            // Skip primitive types and known non-table types
            if (!this.isPrimitiveType(tableName)) {
                // Check if this table contains byte arrays by looking ahead
                this.checkTableForByteArrays(tableName, fieldName);
            }
        }
    }

    /**
     * Check if a type name is a primitive type
     */
    private isPrimitiveType(typeName: string): boolean {
        const primitiveTypes = new Set([
            'bool', 'byte', 'ubyte', 'short', 'ushort', 'int', 'uint', 
            'float', 'long', 'ulong', 'double', 'string'
        ]);
        return primitiveTypes.has(typeName);
    }

    /**
     * Check if a table contains byte array fields
     */
    private checkTableForByteArrays(tableName: string, parentField: string): void {
        const lines = this.schemaContent.split('\n');
        let inTable = false;
        let tableDepth = 0;

        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Check if we're entering the target table
            if (trimmedLine === `table ${tableName} {`) {
                inTable = true;
                tableDepth = 1;
                continue;
            }

            if (inTable) {
                // Count braces to track table depth
                const openBraces = (line.match(/\{/g) || []).length;
                const closeBraces = (line.match(/\}/g) || []).length;
                tableDepth += openBraces - closeBraces;

                // If we've exited the table, stop looking
                if (tableDepth <= 0) {
                    break;
                }

                // Look for byte array fields within this table
                const byteArrayPattern = /^\s*(\w+)\s*:\s*\[(?:u?)byte\]/;
                const match = line.match(byteArrayPattern);
                
                if (match) {
                    const fieldName = match[1];
                    const fullFieldPath = `${parentField}.${fieldName}`;
                    this.byteArrayFields.add(fullFieldPath);
                    console.debug(`SchemaParser: Detected nested byte array field: ${fullFieldPath}`);
                }
            }
        }
    }

    /**
     * Get all detected byte array fields
     */
    public getByteArrayFields(): Set<string> {
        return new Set(this.byteArrayFields);
    }

    /**
     * Check if a specific field path should be encoded as Base64
     */
    public shouldEncodeAsBase64(fieldPath: string): boolean {
        // First check for exact match
        if (this.byteArrayFields.has(fieldPath)) {
            console.debug(`SchemaParser: Exact match found for "${fieldPath}"`);
            return true;
        }

        // Normalize path by removing array indices for pattern matching
        const normalizedPath = fieldPath.replace(/\[\d+\]/g, '');
        if (this.byteArrayFields.has(normalizedPath)) {
            console.debug(`SchemaParser: Pattern match found for "${fieldPath}" -> normalized to "${normalizedPath}"`);
            return true;
        }

        console.debug(`SchemaParser: No match found for "${fieldPath}"`);
        console.debug(`SchemaParser: Available byte array fields:`, Array.from(this.byteArrayFields));
        return false;
    }

    /**
     * Get byte array fields for a specific object path
     */
    public getByteArrayFieldsForPath(path: string): string[] {
        return Array.from(this.byteArrayFields).filter(field => 
            field.startsWith(path + '.') || field === path
        );
    }

    /**
     * Add known binary data fields from the DUC schema
     */
    private addKnownBinaryFields(): void {
        // Add the known binary data field from BinaryFileData table
        this.byteArrayFields.add('data');
        this.byteArrayFields.add('files.entries.value.data');
        
        // Add common binary field patterns
        this.byteArrayFields.add('thumbnail');
        this.byteArrayFields.add('version_graph.checkpoints.data');
        this.byteArrayFields.add('external_files.value.data');
        
        console.debug('SchemaParser: Added known binary fields: data, files.entries.value.data, thumbnail, version_graph.checkpoints.data, external_files.value.data');
    }
} 