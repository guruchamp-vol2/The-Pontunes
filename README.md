# The Pontunes

Node web service prepared for Render, with a responsive Pontunes homepage
featuring the Pacific Northwest band's background, repertoire, member list, official
website link, and a small Voice Mentor site-support note. The reference website at
https://www.pontunesmusic.com/ currently displays a Squarespace expiration page.
This is an original landing page, not a verified replica of its former design.

The eight supplied band photographs are served locally from `public/images/`.
Group photos appear in the introduction and About section, with six performance
photos in the gallery. Portraits are not assigned to members without confirmed
identifications. Gallery photos open at their original size when selected.

The Contact Us page at `/contact/` displays the band contact email configured in
the admin page. Until an address is saved, it shows the email-not-set notice.
Visitors can open their email app using the address link; the site does not send
messages itself. The separate Voice Mentor website-support email remains in the footer.

## Development

Requires Node 22 or newer (Render uses Node 24.19.0).

```sh
npm ci
npm test
npm start
```

The server uses `PORT` (default 3000) and binds to `0.0.0.0`.
`GET /healthz` reports process health. Pages and assets are served from `public/`;
directory requests resolve to `index.html`. `/` serves the Pontunes homepage.
Health checks alone do not establish website readiness.

## Render

Create a Render Blueprint using `render.yaml`, or create a Node web
service with build command `npm ci`, start command `npm start`, and health check
path `/healthz`. Public pages require no credentials. Administration requires the server-only
`ADMIN_PASSWORD` environment variable.

For the existing service, pushes to `main` deploy when Render auto-deploy is
enabled. Otherwise use **Manual Deploy → Deploy latest commit** in Render.

Before deployment, validate the homepage, navigation, images, responsive layout,
and any reference-site features. A static copy cannot reproduce backend features
such as form delivery without additional implementation and configuration.

## Shows, news, and administration

Public listings are available at `/shows/` (date ascending) and `/news/` (newest
first). All saved entries are published immediately, including past shows. No
sample events or news are invented. The homepage, photographs, and contact page
retain their existing content.

Visit `/admin/` to sign in, switch between Shows and News, add entries, or follow
an entry's Edit link. Editing supports updating and deleting; deletion requires
an explicit confirmation checkbox. Show dates are calendar dates; enter any time
and its timezone in the separate Time field. Details are plain text, with line
breaks preserved. Event links must use HTTP or HTTPS.

Configure a strong, unique `ADMIN_PASSWORD` through your hosting provider's secure
environment settings. Never commit the password. There is no default password;
without it, `/admin/` returns 503 while public pages continue to work. For local
development, export this variable in your shell before `npm start` (the server
does not automatically load `.env` files). Password changes require a restart.

Sessions use random server-side tokens and HttpOnly, SameSite=Strict cookies.
They expire after eight hours and are invalidated by sign-out or server restart.
Production (`NODE_ENV=production`) adds Secure cookies, requiring HTTPS in the
browser. Forms have CSRF protection and login attempts are limited to five failed
attempts per connection IP per 15 minutes. Behind a reverse proxy this can be a
shared limit; forwarded IP headers are deliberately not trusted. Session and
rate-limit state are in memory and reset on restart.

### Persistent storage and Render deployment

`DATA_DIR` defaults to `./data` relative to the server's working directory. The
server saves `content.json` there using atomic replacement and restrictive file
permissions. Keep this directory **outside `public/`**. The storage design supports
one Node process / one service instance; do not run multiple writers or replicas.
Back up `content.json` independently (or use disk snapshots) before maintenance.
A failed write returns an error and leaves the previously published data intact.
Malformed existing storage fails startup rather than silently erasing content.

The updated `render.yaml` requests Render's **paid Starter plan**, a 1 GB
persistent disk at `/var/data/pontunes`, `DATA_DIR` pointing to that disk, and a
manually supplied `ADMIN_PASSWORD`. Review the paid plan before applying the
Blueprint. For an existing manually configured service, make these changes in
Render too: a code push alone does not provision a disk or set your password.
Render's free service filesystem is ephemeral and is unsuitable for this storage.
Do not enable admin writes on an ephemeral filesystem if content must be retained.

After configuring the disk and password, deploy and verify `/`, `/contact/`,
`/shows/`, and `/news/`; sign in at `/admin/`, save an entry, then restart the
service and confirm the public entry remains. No Render settings or live
deployment are changed by the local tests. `npm test` covers authenticated CRUD,
CSRF, validation, escaping, login throttling, restart persistence, static-file
protection, the contact page, and all eight photographs. There is no build step
or third-party runtime dependency.

### Configure the contact email

Sign in at `/admin/` and choose **Contact email**. Enter the band's email address
and select **Save contact email**. The address appears immediately on `/contact/`
as a clickable email link. Leave the field blank and save to restore the
email-not-set notice. Settings share the existing persistent disk with shows and
news, survive restarts, and use the same authentication and CSRF protection.
Existing content files are supported without migration.

This publishes an address for an existing mailbox. It does not create a mailbox,
configure SMTP, or send email from the site. The Voice Mentor support address in
the footer is separate and is not changed by this setting.
