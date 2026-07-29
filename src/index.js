'use strict'

const { Transform, pipeline } = require('stream')

const {
  fileTypeFromBuffer,
  reasonableDetectionSizeInBytes
} = require('file-type')

const canSetContentType = res =>
  !res.headersSent && res.getHeader?.('content-type') === undefined

module.exports = res => {
  let chunks = []
  let length = 0

  const sampling = () => chunks !== null

  const sniff = async callback => {
    const sample = Buffer.concat(chunks)
    chunks = null

    try {
      const { mime } = (await fileTypeFromBuffer(sample)) ?? {}
      if (mime && canSetContentType(res)) res.setHeader('content-type', mime)
    } catch {
      // detection never gets in the way of the payload
    }

    callback(null, sample)
  }

  const sniffer = new Transform({
    transform (chunk, _encoding, callback) {
      if (!sampling()) return callback(null, chunk)

      if (!canSetContentType(res)) {
        chunks = null
        return callback(null, chunk)
      }

      // A container reports a generic type until the sample reaches the marker
      // naming the real one, so detection waits for the full sample.
      chunks.push(chunk)
      length += chunk.length
      if (length < reasonableDetectionSizeInBytes) return callback()

      sniff(callback)
    },

    flush (callback) {
      if (!sampling() || length === 0) return callback()

      sniff(callback)
    }
  })

  // Forward to the response so the caller only pipes once.
  pipeline(sniffer, res, () => {})
  return sniffer
}
