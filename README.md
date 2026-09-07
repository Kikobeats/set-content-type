# @kikobeats/set-content-type

[![Last version](https://img.shields.io/github/v/tag/Kikobeats/set-content-type?style=flat-square)](https://github.com/Kikobeats/set-content-type/releases)
[![Coverage Status](https://img.shields.io/coverallsCoverage/github/Kikobeats/set-content-type?style=flat-square)](https://coveralls.io/github/Kikobeats/set-content-type)
[![NPM Status](https://img.shields.io/npm/dm/@kikobeats/set-content-type?style=flat-square)](https://www.npmjs.com/package/@kikobeats/set-content-type)

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

It returns a writable stream **already piped to `res`** — pipe your upstream into
it and you are done.

The header is always set before the first byte is written to `res`, and an
existing `content-type` is never overridden. Detection is delegated to
[`fileTypeStream`](https://github.com/sindresorhus/file-type#filetypestreamwebstream-options),
which holds a sample before deciding, so a signature split across chunk
boundaries is still recognized and a container reports its real type rather than
its envelope — a `.docx` as a Word document rather than `application/zip`.

Buffering is bounded by that sample and nothing beyond it is held, so a body
smaller than the sample reaches `res` when the upstream ends. Nothing is sampled
at all when `res` already has a `content-type`.

If detection itself fails, the error surfaces on the returned stream and `res`
is destroyed rather than sent a body the sample has already eaten into.

The header is **not** set when:

- `res` already has a `content-type` header.
- the response has already been sent (`res.headersSent`).
- the payload type can not be recognized.

## License

**@kikobeats/set-content-type** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/kikobeats/set-content-type/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Kiko Beats](https://kikobeats.com) with help from [contributors](https://github.com/kikobeats/set-content-type/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/kikobeats) · Twitter [@kikobeats](https://twitter.com/kikobeats)
