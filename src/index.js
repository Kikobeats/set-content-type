'use strict'

const { Duplex, pipeline } = require('stream')
const { fileTypeStream } = require('file-type')

const canSetContentType = res =>
  !res.headersSent && res.getHeader?.('content-type') === undefined

module.exports = res => {
  const sniffer = Duplex.from(async function * (payload) {
    if (!canSetContentType(res)) return yield * payload

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

  pipeline(sniffer, res, () => {})

  return sniffer
}
