// Polyfills for Chrome Extension environment
import { Buffer } from 'buffer';

// Make Buffer globally available
(window as any).Buffer = Buffer;
(globalThis as any).Buffer = Buffer;

// Make process available
if (typeof process === 'undefined') {
  (window as any).process = {
    env: {},
    version: '',
    versions: {},
    nextTick: (fn: Function) => Promise.resolve().then(() => fn())
  };
}

export {};
