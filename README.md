# Duc - VS Code Extension

A Visual Studio Code extension that opens `.duc` files as SQLite databases.

![Duc Preview Example](documentation/thumbnail.png)

## Features

- Automatically associates `*.duc` files with the SQLite Viewer editor
- Uses [SQLite Viewer](https://marketplace.visualstudio.com/items?itemName=qwtel.sqlite-viewer) to inspect `.duc` contents
- Keeps your workflow lightweight (no custom conversion pipeline)

## Requirements

This extension depends on the SQLite Viewer extension and declares it as an extension dependency. VS Code will install it automatically when needed.

## Usage

1. Install the extension
2. Open a .duc file in VS Code
3. The file will automatically open with SQLite Viewer

Alternatively, you can:

1. Right-click on a `.duc` file in the Explorer
2. Choose **Reopen Editor With...**
3. Select **SQLite Viewer**

## How it works

The extension:

1. Declares SQLite Viewer as an extension dependency
2. Sets `workbench.editorAssociations` default so `*.duc` opens as `sqlite-viewer.view`
3. Delegates all data inspection to SQLite Viewer

## Troubleshooting

### Common Issues

1. **A `.duc` file does not open in SQLite Viewer**
   - Use **Reopen Editor With...** and pick SQLite Viewer
   - Verify SQLite Viewer extension is installed and enabled

2. **SQLite Viewer reports invalid database**
   - Confirm the `.duc` file is a valid SQLite database file

## Development

### Extension Development

- Open this project in VS Code
- `npm install`
- `npm run watch` or `npm run compile`
- Press `F5` to start debugging

### CI/CD

This extension uses GitHub Actions for continuous integration and delivery:

- Automated versioning using semantic-release
- Automated packaging and publishing to VS Code Marketplace
- Automated GitHub releases with change notes

To contribute, please follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for your commit messages to ensure proper versioning.

## License

MIT
