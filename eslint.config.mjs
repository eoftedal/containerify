import { defineConfig } from "eslint/config";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all,
});

export default defineConfig([
	{
		extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"),

		plugins: {
			"@typescript-eslint": typescriptEslint,
		},
		ignores: ["tests/integration/app/**/*", "lib/**/*", "lib/**/*.ts"],

		languageOptions: {
			globals: {
				...Object.fromEntries(Object.entries(globals.browser).map(([key]) => [key, "off"])),
			},

			parser: tsParser,
			ecmaVersion: "latest",
			sourceType: "module",
		},
	},
]);
