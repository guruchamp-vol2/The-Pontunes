import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('./public/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8',
};

export function createServer(root = defaultRoot) {
  return http.createServer(async (req, res) => {
    const respond = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return respond(405, 'Method not allowed\n');
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') return respond(200, 'ok\n');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0') || pathname.includes('\\')) return respond(400, 'Invalid path\n');
      if (pathname.split('/').some(segment => segment.startsWith('.'))) return respond(404, 'Not found\n');
      const base = await realpath(root);
      let file = path.resolve(base, '.' + pathname);
      if (file !== base && !file.startsWith(base + path.sep)) return respond(404, 'Not found\n');
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      file = await realpath(file);
      if (!file.startsWith(base + path.sep)) return respond(404, 'Not found\n');
      const info = await stat(file);
      if (!info.isFile()) return respond(404, 'Not found\n');
      res.writeHead(200, {
        'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': info.size,
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      if (error instanceof URIError) return respond(400, 'Invalid path\n');
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return respond(404, 'Not found\n');
      console.error('Request failed:', error.message);
      respond(500, 'Server error\n');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`Pontunes server listening on port ${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
