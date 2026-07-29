'use strict'

const { fileTypeFromBuffer } = require('file-type')
const { Transform, pipeline } = require('stream')

// What `file-type` needs for the formats whose signature is not in the leading
// bytes. Nothing is held back once the type is known.
const MINIMUM_BYTES = 4100

const hasContentType = res => {
  if (typeof res.hasHeader === 'function') return res.hasHeader('content-type')
  if (typeof res.getHeader === 'function') {
    return res.getHeader('content-type') !== undefined
  }
  return false
}

module.exports = res => {
  const sample = []
  let sampled = 0
  let settled = false

  const detect = async () => {
    const payload = Buffer.concat(sample)
    const result = await fileTypeFromBuffer(payload).catch(() => undefined)
    if (result?.mime && !res.headersSent) {
      res.setHeader('content-type', result.mime)
    }
    return { payload, mime: result?.mime }
  }

  const release = (callback, payload) => {
    settled = true
    callback(null, payload)
  }

  const sniffer = new Transform({
    transform (chunk, _encoding, callback) {
      if (settled) return callback(null, chunk)

      // Respect an existing `content-type` and a response already on the wire.
      if (res.headersSent || hasContentType(res)) { return release(callback, chunk) }

      sample.push(chunk)
      sampled += chunk.length

      detect()
        .then(({ payload, mime }) => {
          if (mime === undefined && sampled < MINIMUM_BYTES) return callback()
          release(callback, payload)
        })
        .catch(() => release(callback, Buffer.concat(sample)))
    },

    flush (callback) {
      if (settled || sampled === 0) return callback()
      release(callback, Buffer.concat(sample))
    }
  })

  // Forward to the response so the caller only pipes once.
  pipeline(sniffer, res, () => {})
  return sniffer
}
