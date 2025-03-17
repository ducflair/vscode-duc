# Contributing to Duc Preview

Thank you for your interest in contributing to Duc Preview! This document provides some basic guidelines for contributing to this project.

## Development Setup

1. Fork and clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run watch` to start the TypeScript compiler in watch mode
4. Press `F5` to launch the extension in a new VS Code window

## Code Style

This project uses ESLint for code style enforcement. Run `npm run lint` to check your code.

## Pull Requests

1. Create a branch for your changes
2. Make your changes
3. Run tests and ensure linting passes
4. Submit a pull request

## Extensions Structure

- `src/ducViewerEditor.ts`: Main editor implementation for Duc files
- `src/flatcManager.ts`: Manages downloading and using the FlatBuffers compiler
- `src/extension.ts`: Entry point for the extension
- `src/dispose.ts`: Utilities for resource disposal
- `src/util.ts`: Miscellaneous utilities

## Features & Bug Reports

If you're thinking of adding a new feature or fixing a bug, please first check if an issue already exists, and if not, create one to discuss your planned changes.

## License

By contributing to this project, you agree that your contributions will be licensed under the project's MIT license. 