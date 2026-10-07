# The Pontunes

Node static web service prepared for Render, with a responsive Pontunes homepage
featuring the Pacific Northwest band's background, repertoire, member list, official
website link, and a small Voice Mentor site-support note. The reference website at
https://www.pontunesmusic.com/ currently displays a Squarespace expiration page.
This is an original landing page, not a verified replica of its former design.

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
path `/healthz`. No credentials are required by the static server.

For the existing service, pushes to `main` deploy when Render auto-deploy is
enabled. Otherwise use **Manual Deploy → Deploy latest commit** in Render.

Before deployment, validate the homepage, navigation, images, responsive layout,
and any reference-site features. A static copy cannot reproduce backend features
such as form delivery without additional implementation and configuration.
