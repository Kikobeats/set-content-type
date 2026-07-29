'use strict'

const { Readable, PassThrough } = require('stream')
const test = require('ava').default
const { once } = require('events')

const { reasonableDetectionSizeInBytes } = require('file-type')

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
  Readable.from([Buffer.from([0x01, 0x02, 0x03, 0x04])]).pipe(
    setContentType(res)
  )
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

const neverEnding = () => {
  let timer
  return new Readable({
    read () {
      timer = setTimeout(() => this.push(JPEG), 10)
    },
    destroy (error, callback) {
      clearTimeout(timer)
      callback(error)
    }
  })
}

const pipeNeverEnding = (t, sniffer) => {
  const source = neverEnding()
  t.teardown(() => source.destroy())
  source.pipe(sniffer)
  return source
}

test('destroys the stream when the response goes away', async t => {
  t.timeout(5000)
  const res = createRes()
  const sniffer = setContentType(res)
  pipeNeverEnding(t, sniffer)

  await once(res, 'data')
  const closed = new Promise(resolve => sniffer.once('close', resolve))
  res.destroy()
  await closed

  t.true(sniffer.destroyed)
})

test('does not crash when the response fails mid-stream', async t => {
  t.timeout(5000)
  const res = createRes()
  const sniffer = setContentType(res)
  pipeNeverEnding(t, sniffer)

  await once(res, 'data')
  const closed = new Promise(resolve => sniffer.once('close', resolve))
  res.destroy(new Error('response failed'))
  await closed

  t.true(sniffer.destroyed)
})

const IMAGE = Buffer.concat([JPEG, Buffer.alloc(64, 7)])

const split = (buffer, size) => {
  const parts = []
  for (let index = 0; index < buffer.length; index += size) {
    parts.push(buffer.subarray(index, index + size))
  }
  return parts
}

const chunked = (buffer, size) => Readable.from(split(buffer, size))

// One part in flight at a time, so the byte count reported by `onWrite`
// is what the sniffer has actually taken when the first byte comes out.
const pump = (stream, parts, onWrite) => {
  const next = index => {
    if (index === parts.length) return stream.end()
    onWrite(parts[index].length)
    stream.write(parts[index], () => setImmediate(() => next(index + 1)))
  }
  next(0)
}

test('detects the content-type when the signature spans chunks', async t => {
  const res = createRes()
  chunked(IMAGE, 1).pipe(setContentType(res))
  const output = await collect(res)

  t.is(res.getHeader('content-type'), 'image/jpeg')
  t.deepEqual(output, IMAGE)
})

test('detects the content-type from small chunks', async t => {
  const res = createRes()
  chunked(IMAGE, 3).pipe(setContentType(res))
  const output = await collect(res)

  t.is(res.getHeader('content-type'), 'image/jpeg')
  t.deepEqual(output, IMAGE)
})

test('leaves content-type unset for an unrecognized chunked payload', async t => {
  const payload = Buffer.alloc(32, 1)
  const res = createRes()
  chunked(payload, 1).pipe(setContentType(res))
  const output = await collect(res)

  t.is(res.getHeader('content-type'), undefined)
  t.deepEqual(output, payload)
})

test('reads the content-type from a response without hasHeader', async t => {
  const headers = { 'content-type': 'image/png' }
  const res = Object.assign(new PassThrough(), {
    headersSent: false,
    setHeader: (key, value) => {
      headers[key.toLowerCase()] = value
    },
    getHeader: key => headers[key.toLowerCase()]
  })
  Readable.from([IMAGE]).pipe(setContentType(res))
  await collect(res)

  t.is(headers['content-type'], 'image/png')
})

test('sets the content-type on a response without header helpers', async t => {
  const headers = {}
  const res = Object.assign(new PassThrough(), {
    headersSent: false,
    setHeader: (key, value) => {
      headers[key.toLowerCase()] = value
    }
  })
  Readable.from([IMAGE]).pipe(setContentType(res))
  await collect(res)

  t.is(headers['content-type'], 'image/jpeg')
})

test('releases an unrecognized payload once the sample is full', async t => {
  const payload = Buffer.alloc(reasonableDetectionSizeInBytes + 512, 1)
  const res = createRes()
  const sniffer = setContentType(res)
  const collected = collect(res)

  let written = 0
  let heldUntil = null
  res.on('data', () => {
    heldUntil ??= written
  })

  pump(sniffer, split(payload, 64), size => {
    written += size
  })
  const output = await collected

  t.is(res.getHeader('content-type'), undefined)
  t.deepEqual(output, payload)
  t.true(heldUntil < payload.length)
  t.true(heldUntil <= reasonableDetectionSizeInBytes + 64)
})

test('forwards the payload when the response refuses the header', async t => {
  const res = Object.assign(new PassThrough(), {
    headersSent: false,
    setHeader: () => {
      throw new Error('header refused')
    }
  })
  Readable.from([IMAGE]).pipe(setContentType(res))

  t.deepEqual(await collect(res), IMAGE)
})
