'use strict'

const test = require('ava').default
const { Readable } = require('stream')

const { fileTypeFromBuffer } = require('file-type')

const { createRes, collect } = require('./helpers/response')
const setContentType = require('..')

const CDN = 'https://cdn.microlink.io/file-examples/'

// What settling on the first recognizable prefix reports. The answer keeps
// changing as the prefix grows, so it has to be the smallest prefix rather than
// a fixed one.
const firstMime = async payload => {
  for (let size = 1; size <= payload.length; size++) {
    const result = await fileTypeFromBuffer(payload.subarray(0, size))
    if (result?.mime) return result.mime
  }
}

// `masked` is what that first recognizable prefix reports, absent on the
// samples nothing can mask.
const SAMPLES = [
  {
    file: 'sample.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    masked: 'application/zip'
  },
  {
    file: 'sample.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    masked: 'application/zip'
  },
  {
    file: 'sample.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    masked: 'application/zip'
  },
  {
    file: 'sample.odt',
    mime: 'application/vnd.oasis.opendocument.text',
    masked: 'application/zip'
  },
  {
    file: 'sample.odp',
    mime: 'application/vnd.oasis.opendocument.presentation',
    masked: 'application/zip'
  },
  {
    file: 'sample.epub',
    mime: 'application/epub+zip',
    masked: 'application/zip'
  },
  { file: 'sample.heic', mime: 'image/heic', masked: 'video/mp4' },
  { file: 'sample.heif', mime: 'image/heic', masked: 'video/mp4' },
  { file: 'sample.avif', mime: 'image/heif', masked: 'video/mp4' },
  { file: 'sample.m4a', mime: 'audio/x-m4a', masked: 'video/mp4' },
  { file: 'sample.m4v', mime: 'video/x-m4v', masked: 'video/mp4' },

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

for (const { file, mime, masked } of SAMPLES) {
  test(`detects ${file} over the network`, async t => {
    t.timeout(60000)
    const sniffed = await sniff(file)

    t.is(sniffed.mime, mime)
    t.is(sniffed.payload.length, sniffed.size)

    // Without this the sample could stop exercising masking, and the case
    // above would keep passing while testing nothing.
    if (masked) t.is(await firstMime(sniffed.payload), masked)
  })
}
