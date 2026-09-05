import path from 'path';
import { fileURLToPath } from 'url';
import HtmlWebpackPlugin from 'html-webpack-plugin';

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

export default (_env, argv) => {
  const devtool = argv.mode === 'development' ? 'eval-source-map' : 'source-map';

  /** Web browser bundle */
  const webConfig = {
    name: 'web',
    target: 'web',
    entry: './src/index.ts',
    output: {
      filename: 'bundle.js',
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
    ],
    devtool,
  };

  /** Electron main process (Node.js context) */
  const electronMainConfig = {
    name: 'electron-main',
    target: 'electron-main',
    entry: './src/electron-main.ts',
    output: {
      filename: 'main.js',
      path: path.resolve(__dirname, 'dist/electron'),
      clean: true,
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
    ],
    devtool,
  };

  return [webConfig, electronMainConfig, electronRendererConfig];
};
