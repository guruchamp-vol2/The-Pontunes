import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';

test('the deployed public directory contains a working homepage and stylesheet', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>The Pontunes/);
  assert.match(html, /href="\/style.css"/);
  for (const anchor of ['home', 'about', 'music', 'members']) {
    assert.ok(html.includes(`id="${anchor}"`));
  }
  const style = await fetch(base + '/style.css');
  assert.equal(style.status, 200);
  assert.match(style.headers.get('content-type'), /text\/css/);
  assert.ok((await style.text()).includes('@media(max-width:760px)'));
});

test('serves pages and assets, handles HEAD, and prevents access outside public', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'pontunes-test-'));
  const root = path.join(temp, 'public');
  await mkdir(root);
  await mkdir(path.join(root, 'shows'));
  await writeFile(path.join(root, 'index.html'), '<h1>The Pontunes</h1>');
  await writeFile(path.join(root, 'shows', 'index.html'), '<h1>Shows</h1>');
  await writeFile(path.join(root, 'style.css'), 'body { color: red; }');
  await writeFile(path.join(temp, 'private.txt'), 'private');
  await symlink(path.join(temp, 'private.txt'), path.join(root, 'escape.txt'));
  const server = createServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.equal(await home.text(), '<h1>The Pontunes</h1>');
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.equal(await (await fetch(base + '/shows/')).text(), '<h1>Shows</h1>');
  const css = await fetch(base + '/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), '21');
  assert.equal(await (await fetch(base + '/healthz')).text(), 'ok\n');
  for (const uri of ['/missing', '/escape.txt', '/.env', '/%2e%2e%2fprivate.txt']) {
    assert.equal((await fetch(base + uri)).status, 404, uri);
  }
  assert.equal((await fetch(base + '/%ZZ')).status, 400);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
});
