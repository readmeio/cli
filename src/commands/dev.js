import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { binName } from '../utils/styles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const command = 'dev';
export const description = 'Start a local dev server to preview your docs';
export const beta = true;

export function args(cmd) {
  cmd.option('--port <number>', 'Port to run the dev server on');
}

export async function run(options, _cmd, ctx) {
  const { gitRoot } = ctx;

  process.env.DOCS_ROOT = gitRoot;
  process.env.NEXT_TELEMETRY_DISABLED = '1';

  const devDir = path.join(__dirname, '..', 'dev');

  // Suppress Next.js noisy compile/request logging
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    stream.write = (chunk, ...args) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString();
      if (/^ [○✓⨯▲ ]*(Compiled|Compiling|GET |POST |⚠|Warning:)/.test(str)) return true;
      return original(chunk, ...args);
    };
  }

  const next = (await import('next')).default;
  const app = next({ dev: true, dir: devDir, quiet: true });
  await app.prepare();

  const handle = app.getRequestHandler();

  // SSE clients for live reload
  const reloadClients = new Set();

  const server = createServer((req, res) => {
    if (req.url === '/__reload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: connected\n\n');
      reloadClients.add(res);
      req.on('close', () => reloadClients.delete(res));
      return;
    }
    handle(req, res);
  });

  // Watch for .md / .yaml file changes and notify browsers
  fs.watch(gitRoot, { recursive: true }, (_event, filename) => {
    if (filename && (filename.endsWith('.md') || filename.endsWith('.yaml'))) {
      for (const client of reloadClients) {
        client.write('data: reload\n\n');
      }
    }
  });

  const startPort = options.port ? parseInt(options.port, 10) : 4523;

  function listen(port) {
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(listen(port + 1));
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(port, () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    });
  }

  const port = await listen(startPort);
  console.log();
  console.log(`  ${chalk.hex('#018ef5')(`🦉 ${binName()} dev`)} server running`);
  console.log(`  ${chalk.dim('→')} ${chalk.cyan(`http://localhost:${port}`)}`);
  console.log();
}
