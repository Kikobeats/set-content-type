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

  // Nothing links `res` back to `sniffer` until `forward` runs, so a response
  // that goes away while the sample is still filling would leave it draining
  // the upstream into a body no one will read.
  res.once('close', () => sniffer.destroy())

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
    // The sample was read off `source` and is unreachable once detection
    // throws, so forwarding what is left would serve a truncated body as 200.
    error => res.destroy(error)
  )

  return sniffer
}
