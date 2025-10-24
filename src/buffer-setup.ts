// Buffer polyfill setup - MUST BE IMPORTED FIRST
import { Buffer } from 'buffer';

// Set up Buffer globally IMMEDIATELY
(globalThis as any).Buffer = Buffer;
(window as any).Buffer = Buffer;

if (typeof process === 'undefined') {
  (globalThis as any).process = {
    env: {},
    version: 'v18.0.0',
    versions: {},
    nextTick: (fn: Function) => Promise.resolve().then(() => fn())
  };
}

console.log('[Buffer Setup] Buffer is now globally available:', typeof Buffer);

export { Buffer };
