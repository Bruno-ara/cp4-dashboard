import assert from 'node:assert/strict'
import test from 'node:test'
import { getCurrentReadings, getSensorHistory } from './api.js'

const currentFixture = {
  id: 'WineSensor002',
  temperature: 0,
  humidity: null,
  luminosity: 0,
  measuredAt: '2026-10-13T19:31:56.582Z',
}

function respond(data) {
  return async () => new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function withFetch(implementation, callback) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = implementation
  try {
    await callback()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('accepts finite readings, null values, and zero without coercion', async () => {
  await withFetch(respond(currentFixture), async () => {
    const readings = await getCurrentReadings()
    assert.equal(readings.temperature, 0)
    assert.equal(readings.humidity, null)
    assert.equal(readings.luminosity, 0)
  })
})

test('rejects invalid current reading values and dates', async (context) => {
  for (const [field, value] of [['temperature', 'incorreto'], ['humidity', 'NaN'], ['luminosity', 'Infinity'], ['measuredAt', 'data-invalida']]) {
    await context.test(`${field}=${String(value)}`, async () => {
      await withFetch(respond({ ...currentFixture, [field]: value }), async () => {
        await assert.rejects(getCurrentReadings(), /valores ou data inválidos/)
      })
    })
  }
})

test('accepts empty history and preserves zero-valued points', async () => {
  await withFetch(respond({
    id: 'WineSensor002',
    attribute: 'temperature',
    count: 2,
    points: [
      { value: 0, receivedAt: '2026-10-13T19:13:49.374Z' },
      { value: 25.5, receivedAt: '2026-10-13T19:31:56.582Z' },
    ],
  }), async () => {
    const points = await getSensorHistory('temperature')
    assert.equal(points.length, 2)
    assert.equal(points[0].value, 0)
    assert.ok(Number.isFinite(points[0].timestamp))
  })

  await withFetch(respond({ id: 'WineSensor002', attribute: 'humidity', count: 0, points: [] }), async () => {
    assert.deepEqual(await getSensorHistory('humidity'), [])
  })
})

test('rejects invalid history points and query arguments', async () => {
  await withFetch(respond({
    id: 'WineSensor002',
    attribute: 'temperature',
    count: 1,
    points: [{ value: 'incorreto', receivedAt: '2026-10-13T19:13:49.374Z' }],
  }), async () => {
    await assert.rejects(getSensorHistory('temperature'), /pontos inválidos/)
  })
  await assert.rejects(getSensorHistory('smoke'), /Atributo histórico inválido/)
  await assert.rejects(getSensorHistory('temperature', 101), /inteiro entre 1 e 100/)
})

test('ends a pending request with a retryable timeout error', async () => {
  await withFetch((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }), async () => {
    await assert.rejects(
      getCurrentReadings({ timeoutMs: 15 }),
      (error) => error.name === 'TimeoutError' && /Tente novamente/.test(error.message),
    )
  })
})

test('preserves intentional caller cancellation as AbortError', async () => {
  const controller = new AbortController()
  await withFetch((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }), async () => {
    const request = getSensorHistory('humidity', 20, { signal: controller.signal, timeoutMs: 1000 })
    controller.abort()
    await assert.rejects(request, (error) => error.name === 'AbortError')
  })
})
