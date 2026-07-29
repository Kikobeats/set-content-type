'use strict'

const test = require('ava').default
const { Readable } = require('stream')

const { fileTypeFromBuffer } = require('file-type')

const { createRes, collect } = require('./helpers/response')
const setContentType = require('..')

const CDN = 'https://cdn.microlink.io/file-examples/'

// What the smallest recognizable prefix reports, which is not the final answer
// whenever the sample has to keep reading to name the real format.
const firstMime = async payload => {
  for (let size = 1; size <= payload.length; size++) {
    const result = await fileTypeFromBuffer(payload.subarray(0, size))
    if (result?.mime) return result.mime
  }
}

// `masks` marks the samples whose envelope hides the real format: a container
// reading as `application/zip`, an ftyp box reading as `video/mp4`.
const SAMPLES = [
  {
    file: 'sample.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    masks: true
  },
  {
    file: 'sample.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    masks: true
  },
  {
    file: 'sample.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    masks: true
  },
  {
    file: 'sample.odt',
    mime: 'application/vnd.oasis.opendocument.text',
    masks: true
  },
  {
    file: 'sample.odp',
    mime: 'application/vnd.oasis.opendocument.presentation',
    masks: true
  },
  { file: 'sample.epub', mime: 'application/epub+zip', masks: true },
  { file: 'sample.heic', mime: 'image/heic', masks: true },
  { file: 'sample.heif', mime: 'image/heic', masks: true },
  { file: 'sample.avif', mime: 'image/heif', masks: true },
  { file: 'sample.m4a', mime: 'audio/x-m4a', masks: true },
  { file: 'sample.m4v', mime: 'video/x-m4v', masks: true },

  // `file-type` never names this one, so `application/zip` is the whole answer
  // rather than a placeholder for something better further in.
  { file: 'sample.ods', mime: 'application/zip' },

  { file: 'sample.jpg', mime: 'image/jpeg' },
  { file: 'sample.png', mime: 'image/png' },
  { file: 'sample.gif', mime: 'image/gif' },
  { file: 'sample.pdf', mime: 'application/pdf' }
]

// The upstream is a real HTTPS response, so the chunk boundaries are whatever
// the network produced rather than a shape the test picked.
const sniff = async file => {
  const response = await fetch(CDN + file)
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)

  const res = createRes()
  Readable.fromWeb(response.body).pipe(setContentType(res))

  return {
    payload: await collect(res),
    mime: res.getHeader('content-type'),
    size: Number(response.headers.get('content-length'))
  }
}

for (const { file, mime, masks } of SAMPLES) {
  test(`detects ${file} over the network`, async t => {
    t.timeout(60000)
    const sniffed = await sniff(file)

    t.is(sniffed.mime, mime)
    t.is(sniffed.payload.length, sniffed.size)

    // Without this the sample could stop exercising masking, and the case
    // above would keep passing while testing nothing.
    if (masks) t.not(await firstMime(sniffed.payload), mime)
  })
}
