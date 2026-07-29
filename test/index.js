'use strict'

const { Readable } = require('stream')
const test = require('ava').default
const { once } = require('events')

const { reasonableDetectionSizeInBytes } = require('file-type')

const { createRes, collect } = require('./helpers/response')
const setContentType = require('..')

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

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
  const fillsTheSample = Buffer.concat([
    JPEG,
    Buffer.alloc(reasonableDetectionSizeInBytes, 7)
  ])
  let timer
  return new Readable({
    read () {
      timer = setTimeout(() => this.push(fillsTheSample), 10)
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

const byteByByte = buffer => Readable.from(split(buffer, 1))

// One part in flight at a time, so the byte count the test tracks is what the
// sniffer has actually taken when the first byte comes out.
const write = (stream, part) =>
  new Promise(resolve => stream.write(part, () => setImmediate(resolve)))

test('detects the content-type when the signature spans chunks', async t => {
  const res = createRes()
  byteByByte(IMAGE).pipe(setContentType(res))
  const output = await collect(res)

  t.is(res.getHeader('content-type'), 'image/jpeg')
  t.deepEqual(output, IMAGE)
})

test('leaves content-type unset for an unrecognized chunked payload', async t => {
  const payload = Buffer.alloc(32, 1)
  const res = createRes()
  byteByByte(payload).pipe(setContentType(res))
  const output = await collect(res)

  t.is(res.getHeader('content-type'), undefined)
  t.deepEqual(output, payload)
})

test('sets the content-type on a response without getHeader', async t => {
  const headers = {}
  const res = createRes(headers, { getHeader: undefined })
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

  for (const part of split(payload, 64)) {
    written += part.length
    await write(sniffer, part)
  }
  sniffer.end()
  const output = await collected

  t.is(res.getHeader('content-type'), undefined)
  t.deepEqual(output, payload)
  t.true(heldUntil < payload.length)
  t.true(heldUntil <= reasonableDetectionSizeInBytes + 64)
})

test('forwards the payload when the response refuses the header', async t => {
  const res = createRes(
    {},
    {
      setHeader: () => {
        throw new Error('header refused')
      }
    }
  )
  Readable.from([IMAGE]).pipe(setContentType(res))

  t.deepEqual(await collect(res), IMAGE)
})

// A ZIP whose first entry names the real format, which is how every Office and
// OpenDocument container behaves.
const zipEntry = (name, data) => {
  const filename = Buffer.from(name)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt32LE(data.length, 18)
  header.writeUInt32LE(data.length, 22)
  header.writeUInt16LE(filename.length, 26)
  return Buffer.concat([header, filename, data])
}

const ODT = zipEntry(
  'mimetype',
  Buffer.from('application/vnd.oasis.opendocument.text')
)

test('detects the container type rather than the container', async t => {
  const res = createRes()
  byteByByte(ODT).pipe(setContentType(res))
  const output = await collect(res)

  t.is(res.getHeader('content-type'), 'application/vnd.oasis.opendocument.text')
  t.deepEqual(output, ODT)
})
