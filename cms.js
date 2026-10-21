import { randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const token = () => randomBytes(32).toString('hex');
const ttl = 8 * 60 * 60 * 1000;
const kinds = ['shows', 'news'];
const fields = { shows: ['title', 'date', 'time', 'venue', 'location', 'details', 'link'], news: ['title', 'date', 'details'] };
const validEmail = email => email.length <= 254 && email.split('@')[0].length <= 64
  && !email.startsWith('.') && !email.includes('..') && !email.includes('.@')
  && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(email);
const labels = { title: 'Title', date: 'Date', time: 'Time (include timezone)', venue: 'Venue', location: 'Location', details: 'Details', link: 'Tickets / event URL (optional)' };

export function createCMS({ root, dataDir = process.env.DATA_DIR || path.resolve('data'), password = process.env.ADMIN_PASSWORD, secureCookies = process.env.NODE_ENV === 'production' } = {}) {
  const salt = randomBytes(16);
  const passwordHash = password ? scryptSync(password, salt, 64) : null;
  const sessions = new Map();
  const failures = new Map();
  const filename = path.join(dataDir, 'content.json');
  let data;
  try {
    data = JSON.parse(readFileSync(filename, 'utf8'));
    if (!kinds.every(k => Array.isArray(data[k]))) throw new Error('Invalid content file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = { shows: [], news: [] };
  }
  const persist = next => {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const temporary = filename + '.tmp';
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, filename);
    data = next;
  };
  const template = readFileSync(path.join(root, 'index.html'), 'utf8');
  const contactTemplate = readFileSync(path.join(root, 'contact/index.html'), 'utf8');
  const header = template.match(/<header[\s\S]*?<\/header>/)[0].replace(/href="#/g, 'href="/#');
  const footer = template.match(/<footer[\s\S]*?<\/footer>/)[0];
  const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · The Pontunes</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/cms.css"></head><body>${header}<main class="wrap content-page"><p class="eyebrow">THE PONTUNES</p><h1>${escape(title)}</h1>${body}</main>${footer}</body></html>`;
  const adminNavigation = `<nav class="admin-tabs" aria-label="Administration"><a href="/admin/?kind=shows">Shows</a><a href="/admin/?kind=news">News</a><a href="/admin/settings/">Contact email</a></nav>`;
  const settingsForm = (session, email, message = '') => `${adminNavigation}
    ${message ? `<p role="status">${escape(message)}</p>` : ''}
    <p>Set the address visitors can use to contact the band. It will be published on the Contact Us page.</p>
    <form method="post" action="/admin/settings/">
      <input type="hidden" name="csrf" value="${session.csrf}">
      <label>Contact email<input type="email" name="contactEmail" autocomplete="email" maxlength="254" value="${escape(email)}" aria-describedby="email-help"></label>
      <p id="email-help">Leave blank to remove the address. The contact page will show the email-not-set notice.</p>
      <button class="button">Save contact email</button>
    </form>
    <p>Visitors use their own email app to send messages. Saving an address does not create a mailbox or configure email delivery.</p>
    <a class="text-link" href="/contact/">View Contact Us ↗</a>`;
  const listing = (kind, admin = false) => {
    const entries = [...data[kind]].sort((a, b) => kind === 'shows' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
    return entries.length ? entries.map(item => `<article class="entry"><p class="eyebrow"><time datetime="${escape(item.date)}">${escape(item.date)}</time>${item.time ? ` · ${escape(item.time)}` : ''}</p><h2>${escape(item.title)}</h2>${kind === 'shows' ? `<p>${escape(item.venue)}${item.location ? ` · ${escape(item.location)}` : ''}</p>` : ''}<p class="entry-details">${escape(item.details)}</p>${item.link ? `<a class="text-link" href="${escape(item.link)}" rel="noopener noreferrer">Event details / tickets ↗</a>` : ''}${admin ? `<p><a class="text-link" href="/admin/?kind=${kind}&edit=${item.id}">Edit ${escape(item.title)}</a></p>` : ''}</article>`).join('') : `<p>No ${kind === 'shows' ? 'shows announced' : 'news posted'} yet. Please check back soon.</p>`;
  };
  return async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return false; } // The static handler returns 400 for malformed URLs.
    const route = url.pathname.replace(/\/$/, '');
    if (!['/admin', '/admin/login', '/admin/logout', '/admin/save', '/admin/delete', '/admin/settings', '/shows', '/news', '/contact', '/contact/index.html'].includes(route)) return false;
    const sendDocument = (status, document) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
      res.end(req.method === 'HEAD' ? undefined : document);
      return true;
    };
    const send = (status, title, body) => sendDocument(status, page(title, body));
    const redirect = target => { res.writeHead(303, { Location: target, 'Cache-Control': 'no-store' }); res.end(); return true; };
    if (['/contact', '/contact/index.html'].includes(route)) {
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed', '<p>Use GET to view this page.</p>');
      const email = data.settings?.contactEmail || '';
      if (!email) return sendDocument(200, contactTemplate);
      const document = contactTemplate
        .replace('Contact The Pontunes. The email address for contact messages has not been set yet.', 'Contact The Pontunes by email.')
        .replace(/<section class="contact-notice"[\s\S]*?<\/section>/, () => `<section class="contact-notice" aria-labelledby="contact-status">
      <h2 id="contact-status">Email The Pontunes</h2>
      <p>For questions and enquiries, email <a href="mailto:${escape(encodeURIComponent(email))}">${escape(email)}</a>.</p>
    </section>`);
      return sendDocument(200, document);
    }
    if (['/shows', '/news'].includes(route)) {
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed', '<p>Use GET to view this page.</p>');
      const kind = route.slice(1);
      return send(200, kind === 'shows' ? 'Shows' : 'News', listing(kind));
    }
    if (!passwordHash) return send(503, 'Admin unavailable', '<p>Administration is disabled until the server administrator configures ADMIN_PASSWORD.</p>');
    const now = Date.now();
    for (const [key, session] of sessions) if (session.expires <= now) sessions.delete(key);
    for (const [key, failure] of failures) if (failure.expires <= now) failures.delete(key);
    const sessionId = /(?:^|;\s*)pontunes_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const session = sessions.get(sessionId);
    const cookie = value => res.setHeader('Set-Cookie', `pontunes_session=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${value ? ttl / 1000 : 0}${secureCookies ? '; Secure' : ''}`);
    const login = message => `<p role="status">${escape(message)}</p><form method="post" action="/admin/login"><label>Admin password<input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label><button class="button">Sign in</button></form>`;
    try {
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (!['/admin', '/admin/settings'].includes(route)) return send(405, 'Method not allowed', '<p>This action requires a form submission.</p>');
        if (!session) return send(200, 'Admin sign in', login('Enter your password to manage shows, news, and the contact email.'));
        if (route === '/admin/settings') return send(200, 'Contact email settings', settingsForm(session, data.settings?.contactEmail || '', url.searchParams.get('saved') === '1' ? 'Contact email saved.' : ''));
        const kind = kinds.includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'shows';
        const item = data[kind].find(x => x.id === url.searchParams.get('edit'));
        const hidden = `<input type="hidden" name="csrf" value="${session.csrf}"><input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${item?.id || ''}">`;
        return send(200, 'Manage shows & news', `<form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${session.csrf}"><button>Sign out</button></form>${adminNavigation}<p><a class="text-link" href="/${kind}/">View public listing ↗</a></p><h2>${item ? 'Edit' : 'Add'} ${kind === 'shows' ? 'show' : 'news'}</h2><form method="post" action="/admin/save">${hidden}${fields[kind].map(field => `<label>${labels[field]}${field === 'details' ? `<textarea name="details" rows="6" maxlength="10000">${escape(item?.details)}</textarea>` : `<input name="${field}" type="${field === 'date' ? 'date' : field === 'link' ? 'url' : 'text'}" value="${escape(item?.[field])}" maxlength="${field === 'link' ? 2000 : 200}" ${['title', 'date', 'venue'].includes(field) ? 'required' : ''}>`}</label>`).join('')}<button class="button">Save ${kind === 'shows' ? 'show' : 'news'}</button> <a href="/admin/?kind=${kind}">Cancel / new entry</a></form>${item ? `<form method="post" action="/admin/delete">${hidden}<label class="confirm"><input type="checkbox" name="confirm" value="yes" required> Confirm permanent deletion of this entry</label><button class="button danger">Delete entry</button></form>` : ''}<h2>Published ${kind}</h2>${listing(kind, true)}`);
      }
      if (req.method !== 'POST') return send(405, 'Method not allowed', '<p>Use the administration forms.</p>');
      if ((req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) || req.headers['sec-fetch-site'] === 'cross-site') return send(403, 'Request rejected', '<p>Please submit forms from this site.</p>');
      if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return send(415, 'Unsupported form', '<p>Use the administration forms.</p>');
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 32768) return send(413, 'Form too large', '<p>Please shorten your entry.</p>');
      }
      const form = new URLSearchParams(body);
      if (route === '/admin/login') {
        const key = req.socket.remoteAddress;
        const failure = failures.get(key) || { count: 0, expires: now + 15 * 60 * 1000 };
        if (failure.count >= 5) { res.setHeader('Retry-After', '900'); return send(429, 'Try again later', login('Too many attempts. Wait 15 minutes before trying again.')); }
        const candidate = form.get('password') || '';
        if (candidate.length > 1024 || !timingSafeEqual(scryptSync(candidate, salt, 64), passwordHash)) {
          failure.count++; failures.set(key, failure);
          return send(401, 'Admin sign in', login('Incorrect password.'));
        }
        failures.delete(key);
        if (sessionId) sessions.delete(sessionId);
        const id = token();
        sessions.set(id, { csrf: token(), expires: now + ttl });
        cookie(id);
        return redirect('/admin/');
      }
      if (!session || form.get('csrf') !== session.csrf) return send(403, 'Request rejected', '<p>Your session or form has expired. <a href="/admin/">Sign in again</a>.</p>');
      if (route === '/admin/logout') { sessions.delete(sessionId); cookie(''); return redirect('/admin/'); }
      if (route === '/admin/settings') {
        const email = (form.get('contactEmail') || '').trim();
        if (email && !validEmail(email)) return send(400, 'Contact email settings', settingsForm(session, email, 'Enter a valid email address, or leave the field blank to remove it.'));
        persist({ ...data, settings: { ...data.settings, contactEmail: email } });
        return redirect('/admin/settings/?saved=1');
      }
      const kind = form.get('kind');
      if (!kinds.includes(kind)) return send(400, 'Invalid entry', '<p>Unknown content type.</p>');
      const id = form.get('id');
      if (id && !data[kind].some(x => x.id === id)) return send(404, 'Entry not found', '<p>This entry may have already been deleted.</p>');
      let entries;
      if (route === '/admin/delete') {
        if (!id || form.get('confirm') !== 'yes') return send(400, 'Confirmation required', '<p>Confirm deletion using the edit form.</p>');
        entries = data[kind].filter(x => x.id !== id);
      } else if (route === '/admin/save') {
        const item = Object.fromEntries(fields[kind].map(field => [field, (form.get(field) || '').trim()]));
        const validDate = /^\d{4}-\d{2}-\d{2}$/.test(item.date) && !Number.isNaN(Date.parse(item.date)) && new Date(item.date).toISOString().slice(0, 10) === item.date;
        if (!item.title || !validDate || (kind === 'shows' && !item.venue) || fields[kind].some(f => item[f].length > (f === 'details' ? 10000 : f === 'link' ? 2000 : 200))) return send(400, 'Invalid entry', '<p>A title, valid date, and (for shows) venue are required. Check field lengths and use your browser’s Back button to correct the form.</p>');
        if (item.link) {
          try { if (!['https:', 'http:'].includes(new URL(item.link).protocol)) throw new Error(); }
          catch { return send(400, 'Invalid link', '<p>Use a complete HTTP or HTTPS event URL.</p>'); }
        }
        item.id = id || token();
        entries = id ? data[kind].map(x => x.id === id ? item : x) : [...data[kind], item];
      } else return send(405, 'Method not allowed', '<p>Unknown action.</p>');
      persist({ ...data, [kind]: entries });
      return redirect(`/admin/?kind=${kind}`);
    } catch (error) {
      console.error('CMS request failed:', error.message);
      return send(500, 'Unable to save', '<p>The operation could not be completed. Please try again or contact the server administrator.</p>');
    }
  };
}
