'use strict'

const { PassThrough } = require('stream')

// A response that is also a writable stream, so the forwarded payload can be
// asserted while still exposing the header helpers.
const createRes = (headers = {}) => {
  const res = new PassThrough()
  res.headersSent = false
  res.setHeader = (key, value) => {
    headers[key.toLowerCase()] = value
  }
  res.getHeader = key => headers[key.toLowerCase()]
  res.hasHeader = key => headers[key.toLowerCase()] !== undefined
  return res
}

// `res` is the terminal stream, so collecting from it captures the payload
// that reached the response.
const collect = res =>
  new Promise((resolve, reject) => {
    const chunks = []
    res
      .on('data', chunk => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject)
  })

module.exports = { createRes, collect }
