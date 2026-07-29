'use strict'

const { PassThrough } = require('stream')

// `res` is the terminal stream, so collecting from it captures the payload that
// reached the response.
const collect = require('stream/consumers').buffer

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
