import path from 'path';
import { fileURLToPath } from 'url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Shared settings used by all three build targets.
 * Keeps the configs DRY — aliases, loaders, WASM support, and
 * source-map strategy are identical across web and Electron.
 */
const sharedResolve = {
  extensions: ['.ts', '.js', '.wasm'],
  extensionAlias: {
    '.js': ['.ts', '.js'],
  },
  alias: {
    '@rdf-engine': path.resolve(__dirname, 'src/rdf-engine'),
    '@metamodel-manager': path.resolve(__dirname, 'src/metamodel-manager'),
    '@model-manager': path.resolve(__dirname, 'src/model-manager'),
    '@ui': path.resolve(__dirname, 'src/ui'),
    '@platform': path.resolve(__dirname, 'src/platform'),
    '@import-export': path.resolve(__dirname, 'src/import-export'),
  },
};

const sharedModuleRules = [
  { test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ },
  { test: /\.wasm$/, type: 'asset/resource' },
];

const sharedExperiments = { asyncWebAssembly: true };

/**
 * Emit the bundled metamodel assets (TTL + SVG icons) into the output
 * directory, preserving the `assets/` layout.
 *
 * The layout is load-bearing rather than incidental: `src/metamodel-manager/
 * bundled-assets.ts` addresses these files by the same asset-root-relative
 * paths in Node and in the browser, and mirrors the published
 * `https://meta.linked.archi/` tree so icon URIs in the notation data resolve
 * by prefix rewrite alone. Copying verbatim — rather than `asset/resource`
 * imports, which would hash the filenames and need per-file import statements
 * that Vitest cannot resolve — is what keeps both of those true.
 */
const bundledAssetsPlugin = () =>
  new CopyWebpackPlugin({
    patterns: [
      {
        from: path.resolve(__dirname, 'assets'),
        to: 'assets',
        // Skip dotfiles; everything else under assets/ is shipped as-is.
        globOptions: { ignore: ['**/.*'] },
      },
      // diagram-js ships its own stylesheet — selection outlines, the palette,
      // the context pad and the drag cursors are all invisible or unusable
      // without it. It is copied out and linked from index.html rather than
      // imported from TypeScript, because a CSS `import` would need
      // style-loader/css-loader in the build *and* a stub in Vitest, where the
      // same modules are loaded under Node. Copying keeps one code path.
      {
        from: path.resolve(__dirname, 'node_modules/diagram-js/assets/diagram-js.css'),
        to: 'diagram-js.css',
      },
    ],
  });

export default (_env, argv) => {
  const devtool = argv.mode === 'development' ? 'eval-source-map' : 'source-map';

  /** Web browser bundle */
  const webConfig = {
    name: 'web',
    target: 'web',
    entry: './src/index.ts',
    output: {
      // Named by content: `npm run serve` sends no cache headers, and a browser
      // keeps a heuristically fresh `bundle.js` across plain reloads — a
      // rebuild must change the URL for the page to load it.
      filename: 'bundle.[contenthash:8].js',
      chunkFilename: '[name].[contenthash:8].js',
      path: path.resolve(__dirname, 'dist/web'),
      clean: true,
    },
    resolve: {
      ...sharedResolve,
      fallback: {
        fs: false,
        path: false,
      },
    },
    externals: {
      electron: 'commonjs electron',
    },
    module: { rules: [...sharedModuleRules] },
    experiments: { ...sharedExperiments },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/index.html',
        title: 'RDF Architecture Modeler',
      }),
      bundledAssetsPlugin(),
    ],
    devtool,
  };

  /**
   * Electron main process (Node.js context). CommonJS, so `.cjs`: the package is
   * `"type": "module"`, and Node reads a `.js` file in it as ESM. Cleaning keeps
   * the renderer, which the other config writes under this directory.
   */
  const electronMainConfig = {
    name: 'electron-main',
    target: 'electron-main',
    entry: './src/electron-main.ts',
    output: {
      filename: 'main.cjs',
      path: path.resolve(__dirname, 'dist/electron'),
      clean: { keep: /^renderer\// },
    },
    resolve: { ...sharedResolve },
    module: { rules: [...sharedModuleRules] },
    experiments: { ...sharedExperiments },
    devtool,
  };

  /** Electron renderer process (browser-like context with Node integration) */
  const electronRendererConfig = {
    name: 'electron-renderer',
    target: 'electron-renderer',
    entry: './src/index.ts',
    output: {
      filename: 'renderer.js',
      path: path.resolve(__dirname, 'dist/electron/renderer'),
      clean: true,
    },
    resolve: { ...sharedResolve },
    module: { rules: [...sharedModuleRules] },
    experiments: { ...sharedExperiments },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/index.html',
        title: 'RDF Architecture Modeler',
      }),
      bundledAssetsPlugin(),
    ],
    devtool,
  };

  return [webConfig, electronMainConfig, electronRendererConfig];
};
