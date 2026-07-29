'use strict'

const { Transform, pipeline } = require('stream')

const {
  fileTypeFromBuffer,
  reasonableDetectionSizeInBytes
} = require('file-type')

const hasContentType = res => res.getHeader?.('content-type') !== undefined

const mimeFromBuffer = buffer =>
  fileTypeFromBuffer(buffer).then(
    result => result?.mime,
    () => undefined
  )

const setContentTypeHeader = (res, mime) => {
  if (!mime || res.headersSent) return
  try {
    res.setHeader('content-type', mime)
  } catch {
    // a response that refuses the header still gets its payload
  }
}

module.exports = res => {
  let sample = Buffer.alloc(0)
  let settled = false

  const settle = payload => {
    settled = true
    sample = Buffer.alloc(0) // stop pinning the accumulated chunks
    return payload
  }

  const sniffer = new Transform({
    async transform (chunk, _encoding, callback) {
      if (settled) return callback(null, chunk)

      // Respect an existing `content-type` and a response already on the wire.
      if (res.headersSent || hasContentType(res)) {
        return callback(null, settle(chunk))
      }

      sample = Buffer.concat([sample, chunk])
      const mime = await mimeFromBuffer(sample)

      const undetected =
        mime === undefined && sample.length < reasonableDetectionSizeInBytes
      if (undetected) return callback()

      setContentTypeHeader(res, mime)
      callback(null, settle(sample))
    },

    flush (callback) {
      if (settled || sample.length === 0) return callback()
      callback(null, settle(sample))
    }
  })

  // Forward to the response so the caller only pipes once.
  pipeline(sniffer, res, () => {})
  return sniffer
}
