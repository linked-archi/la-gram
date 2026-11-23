/**
 * Puts a channel's build's `localStorage` under its prefix (`storage-scope.ts`, Req 15.10). A module of its own,
 * imported first by the entry point, so that it runs before any other module is evaluated: ES modules run in
 * the order they are imported.
 */
import { scopeBrowserStorage } from './storage-scope.js';

scopeBrowserStorage();
