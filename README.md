# The Pontunes

Node static web service prepared for Render. The reference website has not yet
been imported: `public/` is intentionally empty pending access to
https://www.pontunesmusic.com/. This repository does not yet contain a replica.

## Development

Requires Node 22 or newer (Render uses Node 24.19.0).

```sh
npm ci
npm test
npm start
```

The server uses `PORT` (default 3000) and binds to `0.0.0.0`.
`GET /healthz` reports process health. Pages and assets are served from `public/`;
directory requests resolve to `index.html`. Until reference pages are added,
`/` returns 404. Health checks alone do not establish website readiness.

## Render

After the reference website is implemented and the repository is pushed to
GitHub, create a Render Blueprint using `render.yaml`, or create a Node web
service with build command `npm ci`, start command `npm start`, and health check
path `/healthz`. No credentials are required by the static server.

Before deployment, validate the homepage, navigation, images, responsive layout,
and any reference-site features. A static copy cannot reproduce backend features
such as form delivery without additional implementation and configuration.
