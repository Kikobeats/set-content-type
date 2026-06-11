'use strict'

const { Readable, PassThrough } = require('stream')
const test = require('ava').default

const setContentType = require('..')

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

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

test('sets content-type from the payload bytes when missing', async t => {
  const res = createRes()
  Readable.from([JPEG]).pipe(setContentType(res))
  const output = await collect(res)
  t.is(res.getHeader('content-type'), 'image/jpeg')
  t.deepEqual(output, JPEG)
})

test('does not override an existing content-type', async t => {
  const res = createRes({ 'content-type': 'image/png' })
  Readable.from([JPEG]).pipe(setContentType(res))
  await collect(res)
  t.is(res.getHeader('content-type'), 'image/png')
})

test('does nothing when the response is already on the wire', async t => {
  const res = createRes()
  res.headersSent = true
  Readable.from([JPEG]).pipe(setContentType(res))
  await collect(res)
  t.is(res.getHeader('content-type'), undefined)
})

test('leaves content-type unset for an unrecognized payload', async t => {
  const res = createRes()
  Readable.from([Buffer.from([0x01, 0x02, 0x03, 0x04])]).pipe(setContentType(res))
  await collect(res)
  t.is(res.getHeader('content-type'), undefined)
})

test('forwards the payload unchanged across multiple chunks', async t => {
  const res = createRes()
  const parts = [JPEG, Buffer.from('hello'), Buffer.from('world')]
  Readable.from(parts).pipe(setContentType(res))
  const output = await collect(res)
  t.deepEqual(output, Buffer.concat(parts))
  t.is(res.getHeader('content-type'), 'image/jpeg')
})
