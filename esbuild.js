const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		// kuzu is DEPRECATED (the .elab.kz backend is being phased out). Keep it external
		// rather than bundled: it's loaded lazily via require("kuzu") and is no longer shipped, so
		// the require fails gracefully (handled in KuzuDesignItem.load). Bundling it also broke minify.
		external: ['vscode', '../build/Release/uhdm_addon.node', 'web-tree-sitter', 'kuzu'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	// Schematic webview bundle: digitaljs (JointJS/ELK) + the bridge script.
	// jQuery must be injected as a global (digitaljs's webpack uses ProvidePlugin) and
	// jquery-ui's per-widget UMD files break under esbuild — alias to the prebuilt dist.
	// See docs/spikes/value-display/findings.md "Renderer notes".
	const webviewCtx = await esbuild.context({
		entryPoints: [
			'src/schematic_webview/main.mjs',
		],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: false,
		platform: 'browser',
		outdir: 'dist',
		entryNames: 'schematic_webview',
		inject: ['src/schematic_webview/jquery-shim.mjs'],
		alias: {
			'jquery-ui/ui/widgets/dialog.js': 'jquery-ui/dist/jquery-ui.js',
		},
		loader: {
			'.png': 'dataurl',
			'.gif': 'dataurl',
			'.svg': 'dataurl',
			'.woff': 'dataurl',
			'.woff2': 'dataurl',
			'.ttf': 'dataurl',
			'.eot': 'dataurl',
		},
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await Promise.all([ctx.watch(), webviewCtx.watch()]);
	} else {
		await ctx.rebuild();
		await webviewCtx.rebuild();
		await ctx.dispose();
		await webviewCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
