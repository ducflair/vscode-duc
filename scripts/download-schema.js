#!/usr/bin/env node

/**
 * Build script to download the DUC schema file and embed it into the extension
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SCHEMA_URL = 'https://raw.githubusercontent.com/ducflair/duc/refs/heads/main/schema/duc.fbs';
const SCHEMA_OUTPUT_DIR = path.join(__dirname, '..', 'src', 'assets');
const SCHEMA_OUTPUT_FILE = path.join(SCHEMA_OUTPUT_DIR, 'duc.fbs');
const SCHEMA_TS_FILE = path.join(SCHEMA_OUTPUT_DIR, 'schema.ts');

/**
 * Download a file from a URL to a local file
 */
function downloadFile(url, destPath) {
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

async function main() {
    try {
        console.log('📥 Downloading DUC schema...');
        
        // Ensure the assets directory exists
        if (!fs.existsSync(SCHEMA_OUTPUT_DIR)) {
            fs.mkdirSync(SCHEMA_OUTPUT_DIR, { recursive: true });
        }

        // Download the schema file
        await downloadFile(SCHEMA_URL, SCHEMA_OUTPUT_FILE);
        console.log(`✅ Schema downloaded to: ${SCHEMA_OUTPUT_FILE}`);

        // Read the schema content and generate a TypeScript module
        const schemaContent = fs.readFileSync(SCHEMA_OUTPUT_FILE, 'utf8');
        
        const tsContent = `// This file is auto-generated during build. Do not edit manually.
// Generated from: ${SCHEMA_URL}

export const DUC_SCHEMA = ${JSON.stringify(schemaContent)};
`;

        fs.writeFileSync(SCHEMA_TS_FILE, tsContent);
        console.log(`✅ Schema TypeScript module generated: ${SCHEMA_TS_FILE}`);
        
        console.log('🎉 Schema embedding complete!');
    } catch (error) {
        console.error('❌ Error downloading schema:', error.message);
        process.exit(1);
    }
}

main();
