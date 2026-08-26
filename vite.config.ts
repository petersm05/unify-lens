import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Stamps the service worker with the bundle it belongs to.
 *
 * A browser decides a worker is new by comparing the script's bytes. sw.js is a
 * static file, so a release that changed only the app left it identical — no
 * new worker, no update event, and the "new version" prompt never appeared for
 * exactly the releases people needed to be told about. It only ever fired when
 * the worker itself happened to be edited.
 *
 * Naming the emitted assets ties the two together: the stamp changes when, and
 * only when, there is actually something new to pick up.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    writeBundle(options) {
      const dir = options.dir;
      if (!dir) return;
      const worker = join(dir, 'sw.js');

      let assets: string[];
      try {
        const html = readFileSync(join(dir, 'index.html'), 'utf8');
        assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)]
          .map((match) => match[1] ?? '')
          .sort();
      } catch {
        return;
      }
      if (assets.length === 0) return;

      try {
        const body = readFileSync(worker, 'utf8');
        writeFileSync(worker, `// build: ${assets.join(' ')}\n${body}`);
      } catch {
        // No worker in this build; nothing to stamp.
      }
    },
  };
}

export default defineConfig({
  plugins: [stampServiceWorker()],
  // Emit relative asset URLs so one build runs from any path: the root of a
  // host, a project subpath like /unify-lens/ on GitHub Pages, or file:// inside
  // a native shell. Nothing in the bundle may assume it is served from /.
  base: './',
  server: {
    // Cognito redirects back to this exact origin, so the port must be stable
    // and the URL must be on the app client's callback allowlist. 4200 belongs
    // to the main Unify app; Lens sits beside it on 4201. Override with PORT to
    // borrow an origin that is already allowlisted.
    port: Number(process.env['PORT'] ?? 4201),
    strictPort: true,
    // Reachable from a tablet on the same network. Note that a LAN address
    // cannot complete login: Cognito only accepts an http callback for
    // localhost, so testing on a device needs an https origin (see the README).
    host: true,
    // Vite refuses requests whose Host header it does not recognise, which is
    // every tunnel hostname. Without this a tunnel answers 403 before the app
    // is ever reached.
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io', '.trycloudflare.com'],
  },
  preview: {
    port: Number(process.env['PORT'] ?? 4201),
    strictPort: true,
    host: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io', '.trycloudflare.com'],
  },
  build: {
    target: 'es2022',
    // Sourcemaps embed the full TypeScript source of the app. Useful locally;
    // not something to leave sitting on a public host. DEPLOY=1 drops them.
    sourcemap: process.env['DEPLOY'] !== '1',
  },
  optimizeDeps: {
    // The browser bundle ships pre-built ESM; let esbuild pre-bundle it once
    // rather than re-scanning 1.7 MB on every cold start.
    include: ['@bizzdesign/sdk-bundle/browser'],
  },
});
