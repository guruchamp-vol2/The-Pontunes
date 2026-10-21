import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from '../server.js';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pontunes-cms-'));
  const password = randomBytes(32).toString('hex');
  let server;
  let base;
  const start = async () => {
    server = createServer(undefined, { dataDir, password, secureCookies: true, ...options });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = () => new Promise(resolve => server.close(resolve));
  await start();
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  const request = (url, init) => fetch(base + url, { redirect: 'manual', ...init });
  const post = (url, values, cookie = '', headers = {}) => request(url, { method: 'POST', headers: { Cookie: cookie, ...headers }, body: new URLSearchParams(values) });
  const login = async () => {
    const response = await post('/admin/login', { password });
    assert.equal(response.status, 303);
    const setCookie = response.headers.get('set-cookie');
    for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/admin']) assert.ok(setCookie.includes(flag));
    const cookie = setCookie.split(';')[0];
    const html = await (await request('/admin/', { headers: { Cookie: cookie } })).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
    return { cookie, csrf };
  };
  return { request, post, login, dataDir, restart: async () => { await stop(); await start(); } };
}

test('admin CRUD is authenticated, validated, escaped and persistent across restart', async t => {
  const { request, post, login, dataDir, restart } = await fixture(t);
  assert.match(await (await request('/admin/')).text(), /Admin sign in/);
  assert.equal((await post('/admin/save', { kind: 'news' })).status, 403);
  const { cookie, csrf } = await login();
  const show = { csrf, kind: 'shows', title: 'Garden <script>alert(1)</script>', date: '2027-06-12', time: '7 pm Pacific', venue: 'Garden & Hall', location: 'Issaquah', details: 'First line\nSecond line', link: 'https://example.com/tickets' };
  assert.equal((await post('/admin/save', { ...show, csrf: 'wrong' }, cookie)).status, 403);
  assert.equal((await post('/admin/save', show, cookie, { Origin: 'https://evil.example' })).status, 403);
  for (const invalid of [{ date: '2027-02-30' }, { link: 'javascript:alert(1)' }, { title: '' }, { venue: '' }]) {
    assert.equal((await post('/admin/save', { ...show, ...invalid }, cookie)).status, 400);
  }
  assert.equal((await post('/admin/save', show, cookie)).status, 303);
  const news = { csrf, kind: 'news', title: 'Band update', date: '2027-06-01', details: '<img src=x onerror=alert(1)>' };
  assert.equal((await post('/admin/save', news, cookie)).status, 303);
  let publicShow = await (await request('/shows/')).text();
  assert.ok(publicShow.includes('Garden &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(publicShow.includes('Garden &amp; Hall'));
  assert.ok(publicShow.includes('https://example.com/tickets'));
  assert.ok(!publicShow.includes('<script>'));
  assert.match(await (await request('/news/')).text(), /&lt;img src=x onerror=alert\(1\)&gt;/);
  const stored = JSON.parse(await readFile(path.join(dataDir, 'content.json'), 'utf8'));
  const id = stored.shows[0].id;
  const editPage = await (await request(`/admin/?kind=shows&edit=${id}`, { headers: { Cookie: cookie } })).text();
  assert.match(editPage, /Edit show/);
  assert.match(editPage, /Confirm permanent deletion/);
  assert.equal((await post('/admin/save', { ...show, id, title: 'Updated show' }, cookie)).status, 303);
  assert.equal((await post('/admin/save', { ...news, id: stored.news[0].id, title: 'Updated news' }, cookie)).status, 303);
  await restart();
  publicShow = await (await request('/shows/')).text();
  assert.match(publicShow, /Updated show/);
  assert.match(await (await request('/news/')).text(), /Updated news/);
  assert.equal((await post('/admin/save', show, cookie)).status, 403, 'restart expires old sessions');
  const fresh = await login();
  for (const kind of ['shows', 'news']) {
    const entryId = stored[kind][0].id;
    const values = { kind, id: entryId, csrf: fresh.csrf };
    assert.equal((await post('/admin/delete', values, fresh.cookie)).status, 400);
    assert.equal((await post('/admin/delete', { ...values, confirm: 'yes' }, fresh.cookie)).status, 303);
    assert.match(await (await request(`/${kind}/`)).text(), kind === 'shows' ? /No shows announced/ : /No news posted/);
  }
  assert.equal((await post('/admin/logout', { csrf: fresh.csrf }, fresh.cookie)).status, 303);
  assert.equal((await post('/admin/save', { ...show, csrf: fresh.csrf }, fresh.cookie)).status, 403);
});

test('admin is disabled without a password and public listings remain available', async t => {
  const { request } = await fixture(t, { password: '' });
  assert.equal((await request('/admin/')).status, 503);
  assert.equal((await request('/shows/')).status, 200);
  assert.equal((await request('/news/')).status, 200);
  assert.equal((await request('/shows/', { method: 'HEAD' })).status, 200);
});

test('login attempts are throttled and content storage is not served', async t => {
  const { post, request } = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await post('/admin/login', { password: 'wrong' })).status, 401);
  const blocked = await post('/admin/login', { password: 'wrong' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');
  for (const url of ['/data/content.json', '/cms.js', '/.env']) assert.equal((await request(url)).status, 404);
  assert.equal((await request('/admin/delete')).status, 405);
});

test('contact page and all eight photos remain unchanged in the served site', async t => {
  const { request } = await fixture(t);
  assert.equal(await (await request('/contact/')).text(), await readFile(new URL('../public/contact/index.html', import.meta.url), 'utf8'));
  const home = await (await request('/')).text();
  for (const uri of ['/shows/', '/news/']) assert.ok(home.includes(`href="${uri}"`));
  assert.equal([...home.matchAll(/<img /g)].length, 8);
  assert.equal((await request('/cms.css')).status, 200);
});

test('a failed storage write preserves published content and corrupt storage fails startup', async t => {
  const { request, post, login, dataDir } = await fixture(t);
  const { cookie, csrf } = await login();
  const values = { kind: 'news', csrf, title: 'Existing announcement', date: '2027-01-01', details: 'Still here' };
  assert.equal((await post('/admin/save', values, cookie)).status, 303);
  const previous = await readFile(path.join(dataDir, 'content.json'), 'utf8');
  // Force a filesystem error without relying on OS user permission behavior.
  await mkdir(path.join(dataDir, 'content.json.tmp'));
  assert.equal((await post('/admin/save', { ...values, title: 'Should not publish' }, cookie)).status, 500);
  const html = await (await request('/news/')).text();
  assert.match(html, /Existing announcement/);
  assert.doesNotMatch(html, /Should not publish/);
  assert.equal(await readFile(path.join(dataDir, 'content.json'), 'utf8'), previous);
  await writeFile(path.join(dataDir, 'content.json'), 'invalid JSON');
  assert.throws(() => createServer(undefined, { dataDir }), SyntaxError);
});
