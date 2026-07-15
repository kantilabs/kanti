import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { copy } from './build-plugins/vite-plugin.copy';

export default defineConfig({
	build: {
		outDir: '.vite/main',
		minify: 'esbuild',
		lib: {
			entry: './src-main/main.ts',
			fileName: () => '[name].js',
			formats: ['es'],
		},
		
		rollupOptions: {
			external: ['electron', ...builtinModules.map((m) => [m, `node:${m}`]).flat()],
			output: {
				// Rolldown wraps bundled CommonJS dependencies (for example,
				// electron-squirrel-startup) with runtime require() calls. The main
				// bundle is ESM, so provide a Node-compatible require for those
				// wrappers instead of relying on a nonexistent global require.
				banner: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
			},
		},
	},
	plugins: [
		// Copy Go backend binaries to the build output
		copy('./src-go/bin', './resources/bin', true),
	],
	resolve: {
		// Load the Node.js entry.
		mainFields: ['module', 'jsnext:main', 'jsnext'],
	},
	clearScreen: false,
});
