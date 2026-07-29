# @kikobeats/set-content-type

![Last version](https://img.shields.io/github/tag/kikobeats/set-content-type.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/set-content-type.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/set-content-type)
[![NPM Status](https://img.shields.io/npm/dm/@kikobeats/set-content-type.svg?style=flat-square)](https://www.npmjs.org/package/@kikobeats/set-content-type)

> Set the response `content-type` based on the payload bytes.

Some upstreams (e.g. S3/CloudFront origins) stream a response **without** a `content-type` header. When you proxy those bytes, the browser can't tell it's an image and renders it as raw text — worse if you send `x-content-type-options: nosniff`.

This module fixes that: pipe the payload through it and, **only when the response doesn't already have a `content-type`**, it detects the type from the first bytes (via [`file-type`](https://github.com/sindresorhus/file-type)) and sets it on the response before anything is written.

## Install

```bash
$ npm install @kikobeats/set-content-type --save
```

## Usage

Insert it between your upstream and the response:

```js
const setContentType = require('@kikobeats/set-content-type')

server.on('request', (req, res) => {
  upstream.pipe(setContentType(res))
})
```

The returned stream is already wired to `res`, so you only pipe once. If the
upstream already provided a `content-type`, it is left untouched.

## API

### setContentType(res)

#### res

*Required*<br>
Type: `http.ServerResponse`

The outgoing response whose `content-type` should be set when missing.

It returns a [`Transform`](https://nodejs.org/api/stream.html#class-streamtransform)
stream **already piped to `res`** — pipe your upstream into it and you are done.

The header is always set before the first byte is written to `res`. Detection is
delegated to
[`fileTypeStream`](https://github.com/sindresorhus/file-type#filetypestreamwebstream-options),
which samples up to ~4 KB before deciding, so a signature split across chunk
boundaries is still recognized. The payload itself is never buffered.

Sampling that far is what makes containers report their real type: a `.docx`
reads as `application/zip` and a `.heic` as `video/mp4` until the sample reaches
the marker naming the real format. The cost is that the first bytes reach `res`
only once the sample is complete, so a body smaller than the sample is held
until the upstream ends. Nothing is sampled when `res` already has a
`content-type`.

The header is **not** set when:

- `res` already has a `content-type` header.
- the response has already been sent (`res.headersSent`).
- the payload type can not be recognized.

## License

**@kikobeats/set-content-type** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/kikobeats/set-content-type/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Kiko Beats](https://kikobeats.com) with help from [contributors](https://github.com/kikobeats/set-content-type/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/kikobeats) · Twitter [@kikobeats](https://twitter.com/kikobeats)
