'use strict'

const { fileTypeFromBuffer } = require('file-type')
const test = require('ava').default
const { Readable } = require('stream')

const { createRes, collect } = require('./helpers/response')
const setContentType = require('..')

const CDN = 'https://cdn.microlink.io/file-examples/'

// Containers whose first bytes name a generic format: every one of these
// resolves to `application/zip` or `video/mp4` until the sample reaches the
// marker that names the real type.
const CONTAINERS = [
  'sample.docx',
  'sample.xlsx',
  'sample.pptx',
  'sample.odt',
  'sample.ods',
  'sample.odp',
  'sample.epub',
  'sample.heic',
  'sample.heif',
  'sample.m4a',
  'sample.m4v',
  'sample.avif'
]

const PLAIN = ['sample.jpg', 'sample.png', 'sample.gif', 'sample.pdf']

// The upstream is a real HTTPS response, so the chunk boundaries are whatever
// the network produced rather than a shape the test picked.
const sniff = async name => {
  const response = await fetch(CDN + name)
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)

  const res = createRes()
  Readable.fromWeb(response.body).pipe(setContentType(res))
  const payload = await collect(res)

  return { payload, mime: res.getHeader('content-type') }
}

for (const name of [...CONTAINERS, ...PLAIN]) {
  test(`detects ${name} over the network`, async t => {
    t.timeout(60000)
    const { payload, mime } = await sniff(name)
    const expected = (await fileTypeFromBuffer(payload))?.mime

    t.is(mime, expected)
    t.true(payload.length > 0)
  })
}
