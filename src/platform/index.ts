// Platform Abstraction layer — web/Electron file I/O
export type { PlatformService, FileFilter } from './interfaces.js';
export { WebPlatformService } from './web-platform-service.js';
export { ElectronPlatformService } from './electron-platform-service.js';
export { createPlatformService, isElectronEnvironment } from './platform-factory.js';
