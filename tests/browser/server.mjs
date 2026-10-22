// Builds the game once and serves dist/ with `vite preview` (no HMR reloads
// while tests run).
import { build, preview } from 'vite';
export async function startServer(port, root = undefined) {
  await build({ root, logLevel: 'error' });
  const server = await preview({ root, preview: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.httpServer.close(r)) };
}
