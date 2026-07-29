'use strict'

const { PassThrough } = require('stream')

const { buffer: collect } = require('stream/consumers')

// A response that is also a writable stream, so the forwarded payload can be
// asserted while still exposing the header helpers.
const createRes = (headers = {}, overrides = {}) =>
  Object.assign(
    new PassThrough(),
    {
      headersSent: false,
      setHeader: (key, value) => {
        headers[key.toLowerCase()] = value
      },
      getHeader: key => headers[key.toLowerCase()]
    },
    overrides
  )

module.exports = { createRes, collect }
