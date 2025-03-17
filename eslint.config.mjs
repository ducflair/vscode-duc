/**
 * ESLint configuration for the project.
 * 
 * See https://eslint.style and https://typescript-eslint.io for additional linting options.
 */
// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylisticJs from '@stylistic/eslint-plugin';

export default [
	{
		ignores: [
			'node_modules/*',
			'out/*'
		],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
		plugins: {
			'@stylistic': stylisticJs,
		},
		rules: {
			'no-empty': 'error',
			'@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }]
		},
	},
];