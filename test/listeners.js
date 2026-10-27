'use strict'

const { Agent, createServer, get } = require('http')
const { EventEmitter, once } = require('events')
const { Readable } = require('stream')
const test = require('ava').default

const setContentType = require('..')

const REQUESTS = 20
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.alloc(9000, 7)
])

const totalListeners = emitter =>
  emitter
    .eventNames()
    .reduce((total, event) => total + emitter.listenerCount(event), 0)

const trackPeaks = emitter => {
  const peaks = {}
  emitter.on('newListener', event => {
    peaks[event] = Math.max(peaks[event] ?? 0, emitter.listenerCount(event) + 1)
  })
  return peaks
}

const runTrackedServer = async (t, headers) => {
  const requests = []
  const server = createServer((req, res) => {
    requests.push({
      socket: req.socket,
      socketListeners: totalListeners(req.socket),
      peaks: trackPeaks(res)
    })
    for (const [key, value] of Object.entries(headers)) { res.setHeader(key, value) }
    Readable.from([JPEG]).pipe(setContentType(res))
  })
  server.listen(0)
  t.teardown(() => {
    server.closeAllConnections()
    server.close()
  })
  await once(server, 'listening')
  return { url: `http://localhost:${server.address().port}`, requests }
}

const requestSequentially = async url => {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  for (let index = 0; index < REQUESTS; index++) {
    await new Promise((resolve, reject) =>
      get(url, { agent }, res => res.resume().once('end', resolve)).once(
        'error',
        reject
      )
    )
  }
  agent.destroy()
}

for (const [label, headers] of [
  ['detecting', {}],
  ['passing through', { 'content-type': 'image/png' }]
]) {
  test(`does not leak listeners while ${label}`, async t => {
    const { url, requests } = await runTrackedServer(t, headers)
    await requestSequentially(url)

    t.is(requests.length, REQUESTS)
    t.is(new Set(requests.map(({ socket }) => socket)).size, 1)
    t.deepEqual(
      [...new Set(requests.map(({ socketListeners }) => socketListeners))],
      [requests[0].socketListeners]
    )
    for (const { peaks } of requests) {
      for (const [event, peak] of Object.entries(peaks)) {
        t.true(
          peak < EventEmitter.defaultMaxListeners,
          `${peak} ${event} listeners on one response`
        )
      }
    }
  })
}
