import path from 'path';
import { fileURLToPath } from 'url';
import webpack from 'webpack';
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
 * Build-time switches (`src/types/build-flags.d.ts`). A module switched off
 * here is not in the bundle at all: `if (__LA_GRAM_GIT__)` becomes `if (false)`,
 * and webpack drops the branch and the chunk only it imports.
 *
 *   LA_GRAM_GIT=off npm run build      no Git storage (Req 18.1)
 */
const buildFlags = () =>
  new webpack.DefinePlugin({
    __LA_GRAM_GIT__: JSON.stringify(process.env.LA_GRAM_GIT !== 'off'),
  });

/**
 * The deployment's configuration (`src/config.ts`, Req 19.1): with
 * `LA_GRAM_CONFIG=<file>`, the file goes beside `index.html` as
 * `la-gram.config.json` — in the web build and in the desktop renderer, and so
 * in the package `npm run package` makes. Without it, nothing: a deployment
 * may also drop the file into a built directory.
 *
 *   LA_GRAM_CONFIG=deploy/acme.json npm run build
 */
const deploymentConfig = () =>
  process.env.LA_GRAM_CONFIG
    ? [
        new CopyWebpackPlugin({
          patterns: [{ from: path.resolve(process.env.LA_GRAM_CONFIG), to: 'la-gram.config.json' }],
        }),
      ]
    : [];

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
      buildFlags(),
      ...deploymentConfig(),
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
      clean: { keep: /^(renderer\/|preload\.cjs)/ },
    },
    resolve: { ...sharedResolve },
    module: { rules: [...sharedModuleRules] },
    experiments: { ...sharedExperiments },
    devtool,
  };

  /**
   * Electron preload: the bridge the sandboxed renderer reaches the desktop
   * through (`src/electron-preload.ts`). One file — a sandboxed preload can
   * require only `electron` itself.
   */
  const electronPreloadConfig = {
    name: 'electron-preload',
    target: 'electron-preload',
    entry: './src/electron-preload.ts',
    output: {
      filename: 'preload.cjs',
      path: path.resolve(__dirname, 'dist/electron'),
      clean: false,
    },
    resolve: { ...sharedResolve },
    module: { rules: [...sharedModuleRules] },
    devtool,
  };

  /**
   * Electron renderer: the web build, served to a sandboxed window without Node
   * from `app://la-gram/` (`src/electron-main.ts`). The desktop reaches it only
   * through the preload bridge.
   */
  const electronRendererConfig = {
    name: 'electron-renderer',
    target: 'web',
    entry: './src/index.ts',
    output: {
      filename: 'renderer.js',
      path: path.resolve(__dirname, 'dist/electron/renderer'),
      clean: true,
    },
    resolve: {
      ...sharedResolve,
      fallback: {
        fs: false,
        path: false,
      },
    },
    module: { rules: [...sharedModuleRules] },
    experiments: { ...sharedExperiments },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/index.html',
        title: 'RDF Architecture Modeler',
      }),
      bundledAssetsPlugin(),
      buildFlags(),
      ...deploymentConfig(),
    ],
    devtool,
  };

  /**
   * la-gram-git (Phase 3 of the Git collaboration plan): the command-line tool,
   * an ES module for Node, into `packages/la-gram-git/` — the npm package and
   * the container image are made from that folder. Every package it imports
   * stays an import (`externals`), so each installs with its own licence as a
   * dependency of the package; `import.meta.url` is left for Node to answer
   * (`importMeta: false`), so the bundled metamodels (`assets/`) and the CI
   * templates (`ci/`), copied beside `dist/`, are found from where it runs.
   */
  const laGramGitRoot = path.resolve(__dirname, 'packages/la-gram-git');
  const laGramGitConfig = {
    name: 'la-gram-git',
    target: 'node20',
    entry: './src/cli/bin.ts',
    experiments: { outputModule: true },
    output: {
      filename: 'la-gram-git.js',
      path: path.join(laGramGitRoot, 'dist'),
      module: true,
      chunkFormat: 'module',
      library: { type: 'module' },
      clean: true,
    },
    externalsType: 'module',
    externals: [
      ({ request }, callback) =>
        request && !request.startsWith('.') && !path.isAbsolute(request) ? callback(null, request) : callback(),
    ],
    resolve: { ...sharedResolve },
    module: {
      rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }],
      // Left for Node: `new URL(…, import.meta.url)` finds files beside the bundle; no worker runs in Node.
      parser: { javascript: { importMeta: false, url: false, worker: false } },
    },
    plugins: [
      new webpack.BannerPlugin({ banner: '#!/usr/bin/env node', raw: true, entryOnly: true }),
      buildFlags(),
      new CopyWebpackPlugin({
        patterns: [
          { from: path.resolve(__dirname, 'assets'), to: path.join(laGramGitRoot, 'assets'), globOptions: { ignore: ['**/.*'] } },
          { from: path.resolve(__dirname, 'ci'), to: path.join(laGramGitRoot, 'ci') },
          { from: path.resolve(__dirname, 'LICENSE'), to: path.join(laGramGitRoot, 'LICENSE') },
        ],
      }),
    ],
    optimization: { minimize: false },
    devtool: 'source-map',
  };

  return [webConfig, electronMainConfig, electronPreloadConfig, electronRendererConfig, laGramGitConfig];
};
