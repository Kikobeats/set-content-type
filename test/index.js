'use strict'

const { Readable, PassThrough } = require('stream')
const test = require('ava').default
const { once } = require('events')

const { FileTypeParser, reasonableDetectionSizeInBytes } = require('file-type')

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

test('accepts the string writes any writable accepts', async t => {
  const res = createRes()
  const sniffer = setContentType(res)
  sniffer.end('hello world')

  t.deepEqual(await collect(res), Buffer.from('hello world'))
})

test('forwards the payload unchanged across multiple chunks', async t => {
  const res = createRes()
  const parts = [JPEG, Buffer.from('hello'), Buffer.from('world')]
  Readable.from(parts).pipe(setContentType(res))
  const output = await collect(res)
  t.deepEqual(output, Buffer.concat(parts))
  t.is(res.getHeader('content-type'), 'image/jpeg')
})

const FILLS_THE_SAMPLE = Buffer.concat([
  JPEG,
  Buffer.alloc(reasonableDetectionSizeInBytes, 7)
])

const LEAVES_THE_SAMPLE_HUNGRY = Buffer.alloc(8, 7)

// Not `events.once`, which rejects on the `error` that `pipeline` emits ahead
// of `close` when it tears the sniffer down.
const closes = stream => new Promise(resolve => stream.once('close', resolve))

// Written but never ended, so the sniffer stays open for as long as the test
// needs it to.
const pipeStalling = (t, sniffer, chunk) => {
  const source = new PassThrough()
  source.write(chunk)
  t.teardown(() => source.destroy())
  source.pipe(sniffer)
}

for (const [when, error] of [
  ['goes away', undefined],
  ['fails mid-stream', new Error('response failed')]
]) {
  test(`destroys the stream when the response ${when}`, async t => {
    t.timeout(5000)
    const res = createRes()
    const sniffer = setContentType(res)
    pipeStalling(t, sniffer, FILLS_THE_SAMPLE)

    await once(res, 'data')
    const closed = closes(sniffer)
    res.destroy(error)
    await closed

    t.true(sniffer.destroyed)
  })
}

// The sample never fills, so this one tears down with detection still pending
// and not a byte forwarded — the case a deferred `pipeline` used to strand.
test('destroys the stream when the response goes away mid-detection', async t => {
  t.timeout(5000)
  const res = createRes()
  const sniffer = setContentType(res)
  pipeStalling(t, sniffer, LEAVES_THE_SAMPLE_HUNGRY)

  const closed = closes(sniffer)
  res.destroy()
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

// `file-type` reads the sample off the stream before parsing it, so a parser
// that throws leaves those bytes unreachable. Serial and restored, because the
// patch is global for as long as it is installed.
test.serial('destroys the response when detection throws', async t => {
  const { fromBuffer } = FileTypeParser.prototype
  t.teardown(() => {
    FileTypeParser.prototype.fromBuffer = fromBuffer
  })
  FileTypeParser.prototype.fromBuffer = async () => {
    throw new Error('parser blew up')
  }

  const res = createRes()
  Readable.from([IMAGE]).pipe(setContentType(res))

  const error = await t.throwsAsync(collect(res))
  t.is(error.message, 'parser blew up')
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

const html = markup => Readable.from([Buffer.from(markup)])

for (const [name, markup, expected] of [
  ['a doctype', '<!DOCTYPE html><title>woot</title>', 'text/html'],
  ['a bare tag', '<html><body>woot</body></html>', 'text/html'],
  ['a fragment', '<div class="woot">woot</div>', 'text/html'],
  ['a comment', '<!-- woot -->\n<p>woot</p>', 'text/html'],
  ['leading whitespace', '\n\n  <!doctype html>', 'text/html'],
  ['a byte order mark', '﻿<!doctype html>', 'text/html'],
  // xml is the one markup file-type already names, so it never reaches the fallback
  ['an xml declaration', '<?xml version="1.0"?><rss />', 'application/xml'],
  ['prose', 'woot, and then some more woot', undefined],
  ['a tag that only looks like one', '<paragraph>woot</paragraph>', undefined],
  ['markup past the header', `${' '.repeat(512)}<!doctype html>`, undefined]
]) {
  test(`sniffs ${name}`, async t => {
    const res = createRes()
    html(markup).pipe(setContentType(res))
    const output = await collect(res)

    t.is(res.getHeader('content-type'), expected)
    t.deepEqual(output, Buffer.from(markup))
  })
}

test('sniffs markup that spans chunks', async t => {
  const markup = Buffer.from('<!doctype html><title>woot</title>')
  const res = createRes()
  byteByByte(markup).pipe(setContentType(res))
  const output = await collect(res)

  t.is(res.getHeader('content-type'), 'text/html')
  t.deepEqual(output, markup)
})

test('a magic-byte match is never second-guessed as markup', async t => {
  const res = createRes()
  html(Buffer.concat([JPEG, Buffer.from('<!doctype html>')])).pipe(
    setContentType(res)
  )
  await collect(res)

  t.is(res.getHeader('content-type'), 'image/jpeg')
})
