'use strict'

const { Duplex, PassThrough, pipeline } = require('stream')
const { fileTypeStream } = require('file-type')

const canSetContentType = res =>
  !res.headersSent && res.getHeader?.('content-type') === undefined

const detector = res =>
  Duplex.from(async function * (payload) {
    // `Readable.toWeb` reallocates every chunk; `from` enqueues the buffers as is.
    const sampled = await fileTypeStream(ReadableStream.from(payload))
    const mime = sampled.fileType?.mime

    try {
      if (mime && canSetContentType(res)) res.setHeader('content-type', mime)
    } catch {
      // detection never gets in the way of the payload
    }

    yield * sampled
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
