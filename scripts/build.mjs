// Copies public/ → dist/. No bundler: the UI is one HTML file with inline CSS/JS.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
if (!existsSync('dist/index.html')) throw new Error('public/index.html missing');
console.log('built dist/');
