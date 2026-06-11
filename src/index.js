'use strict'

const { fileTypeFromBuffer } = require('file-type')
const { Transform } = require('stream')

const hasContentType = res => {
  if (typeof res.hasHeader === 'function') return res.hasHeader('content-type')
  if (typeof res.getHeader === 'function') {
    return res.getHeader('content-type') !== undefined
  }
  return false
}

module.exports = res => {
  const sniffer = new Transform({
    transform (chunk, _encoding, callback) {
      // Only the first chunk is inspected; `file-type` works on partial data.
      if (this.sniffed) return callback(null, chunk)
      this.sniffed = true

      // Respect an existing `content-type` and a response already on the wire.
      if (res.headersSent || hasContentType(res)) return callback(null, chunk)

      fileTypeFromBuffer(chunk)
        .then(result => {
          if (result?.mime && !res.headersSent) {
            res.setHeader('content-type', result.mime)
          }
          callback(null, chunk)
        })
        .catch(() => callback(null, chunk))
    }
  })

  // Forward to the response so the caller only pipes once.
  sniffer.pipe(res)
  return sniffer
}
