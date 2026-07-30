'use strict'

const { Duplex, PassThrough, pipeline } = require('stream')
const { fileTypeStream } = require('file-type')

const canSetContentType = res =>
  !res.headersSent && res.getHeader?.('content-type') === undefined

/**
 * `file-type` answers for magic bytes, and no text format has any. What that
 * leaves unnamed is markup, which is the payload an upstream most often serves
 * untyped, so the fallback is the one WHATWG defines for it: the patterns below
 * read against the first 512 bytes of the resource.
 * https://mimesniff.spec.whatwg.org/#identifying-a-resource-with-an-unknown-mime-type
 */
const RESOURCE_HEADER_SIZE = 512

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

const HTML_PATTERNS = [
  '<!doctype html',
  '<html',
  '<head',
  '<script',
  '<iframe',
  '<h1',
  '<div',
  '<font',
  '<table',
  '<a',
  '<style',
  '<title',
  '<b',
  '<body',
  '<br',
  '<p'
]

/** A tag pattern only counts when the tag ends there, so `<pre>` is not a `<p>`. */
const TAG_TERMINATOR = /^[\t\n\f\r >]/

const sniffMarkup = header => {
  const bytes = header.indexOf(UTF8_BOM) === 0 ? header.subarray(3) : header
  const text = bytes
    .toString('latin1')
    .replace(/^[\t\n\f\r ]+/, '')
    .toLowerCase()

  if (text.startsWith('<!--')) return 'text/html'

  const tag = HTML_PATTERNS.find(
    pattern =>
      text.startsWith(pattern) &&
      TAG_TERMINATOR.test(text.slice(pattern.length))
  )

  return tag && 'text/html'
}

const detector = res =>
  Duplex.from(async function * (payload) {
    // `Readable.toWeb` reallocates every chunk; `from` enqueues the buffers as is.
    const sampled = await fileTypeStream(ReadableStream.from(payload))
    const chunks = sampled[Symbol.asyncIterator]()

    let mime = sampled.fileType?.mime
    const header = []

    // The bytes are already read, and reading them again as text costs the
    // wait for a header the magic-byte sample went past anyway.
    if (mime === undefined) {
      let size = 0
      while (size < RESOURCE_HEADER_SIZE) {
        const { value, done } = await chunks.next()
        if (done) break
        header.push(value)
        size += value.length
      }
      mime = sniffMarkup(Buffer.concat(header, RESOURCE_HEADER_SIZE))
    }

    try {
      if (mime && canSetContentType(res)) res.setHeader('content-type', mime)
    } catch {
      // detection never gets in the way of the payload
    }

    yield * header

    while (true) {
      const { value, done } = await chunks.next()
      if (done) return
      yield value
    }
  })

module.exports = res => {
  // The entry point is its own stream so callers get the byte mode every
  // writable has; `Duplex.from` alone hands back an object-mode one, which
  // rejects the string writes `res.end('…')` makes routine.
  const sniffer = new PassThrough()

  pipeline(
    canSetContentType(res) ? [sniffer, detector(res), res] : [sniffer, res],
    () => {}
  )

  return sniffer
}
