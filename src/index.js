'use strict'

const { PassThrough, Readable, pipeline } = require('stream')
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

  const source = Readable.toWeb(sniffer)

  fileTypeStream(source).then(
    sampled => {
      const { mime } = sampled.fileType ?? {}
      try {
        if (mime && canSetContentType(res)) res.setHeader('content-type', mime)
      } catch {
        // detection never gets in the way of the payload
      }
      forward(Readable.fromWeb(sampled))
    },
    () => forward(Readable.fromWeb(source))
  )

  return sniffer
}
