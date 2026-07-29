'use strict'

const { PassThrough, pipeline } = require('stream')
const { fileTypeStream } = require('file-type')

const canSetContentType = res =>
  !res.headersSent && res.getHeader?.('content-type') === undefined

module.exports = res => {
  const sniffer = new PassThrough()
  const forward = stream => pipeline(stream, res, () => {})

  if (!canSetContentType(res)) {
    forward(sniffer)
    return sniffer
  }

  // `Readable.toWeb` reallocates every chunk; `from` enqueues the buffers as is.
  const source = ReadableStream.from(sniffer)

  fileTypeStream(source).then(
    sampled => {
      const mime = sampled.fileType?.mime
      try {
        if (mime && canSetContentType(res)) res.setHeader('content-type', mime)
      } catch {
        // detection never gets in the way of the payload
      }
      forward(sampled)
    },
    () => forward(source)
  )

  return sniffer
}
