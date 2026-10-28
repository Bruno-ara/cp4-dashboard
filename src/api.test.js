import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApiError,
  createDevice,
  createEnvironment,
  getCsrfToken,
  getCurrentReadings,
  getDeviceLimits,
  getDevices,
  getEnvironments,
  getSensorHistory,
  getSession,
  login,
  logout,
  saveDeviceLimit,
  subscribeToSessionExpiration,
} from './api.js'

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

test('loads and validates the CSRF token and authenticated session', async () => {
  await withFetch(async (url, options) => {
    assert.equal(options.credentials, 'same-origin')
    if (url === '/api/auth/csrf') {
      return new Response(JSON.stringify({ headerName: 'X-CSRF-TOKEN', token: 'csrf-in-memory' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    assert.equal(url, '/api/auth/me')
    return new Response(JSON.stringify({ username: 'wine-manager' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    assert.deepEqual(await getCsrfToken(), { headerName: 'X-CSRF-TOKEN', token: 'csrf-in-memory' })
    assert.deepEqual(await getSession(), { username: 'wine-manager' })
  })

  await withFetch(respond({ headerName: 'X-CSRF-TOKEN\r\nInjected', token: 'csrf' }), async () => {
    await assert.rejects(getCsrfToken(), /token CSRF não corresponde/)
  })
})

test('sends login and logout with form encoding, same-origin cookies, and CSRF header', async () => {
  const csrf = { headerName: 'X-CSRF-TOKEN', token: 'csrf-in-memory' }
  const calls = []
  await withFetch(async (url, options) => {
    calls.push({ url, options })
    const body = url.endsWith('/login') ? { status: 'authenticated' } : { status: 'logged_out' }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    await login('wine-manager', 'secret password', csrf)
    await logout(csrf)
  })

  assert.equal(calls[0].url, '/api/auth/login')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.equal(calls[0].options.headers['X-CSRF-TOKEN'], csrf.token)
  assert.equal(calls[0].options.body.toString(), 'username=wine-manager&password=secret+password')
  assert.equal(calls[1].url, '/api/auth/logout')
  assert.equal(calls[1].options.method, 'POST')
  assert.equal(calls[1].options.headers['X-CSRF-TOKEN'], csrf.token)
  assert.equal(calls[1].options.body, undefined)
})

test('preserves HTTP status for authentication and access-denied handling', async () => {
  await withFetch(async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  }), async () => {
    await assert.rejects(getSession(), (error) => error instanceof ApiError && error.status === 401)
  })

  await withFetch(async () => new Response(JSON.stringify({ error: 'forbidden' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  }), async () => {
    await assert.rejects(login('wine-manager', 'incorrect', { headerName: 'X-CSRF-TOKEN', token: 'token' }), (error) => error instanceof ApiError && error.status === 403)
  })
})

test('expires the open dashboard on protected 401 without treating session checks as protected data calls', async () => {
  let expirationCount = 0
  const unsubscribe = subscribeToSessionExpiration(() => {
    expirationCount += 1
  })

  try {
    await withFetch(async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }), async () => {
      await assert.rejects(getSession(), (error) => error instanceof ApiError && error.status === 401)
      assert.equal(expirationCount, 0)
      await assert.rejects(getCurrentReadings(), (error) => error instanceof ApiError && error.status === 401)
    })
    assert.equal(expirationCount, 1)
  } finally {
    unsubscribe()
  }
})

test('uses the Java environment, device, and limit contracts', async () => {
  const environment = { id: 2, name: 'Adega principal', description: 'Setor norte' }
  const device = {
    id: 9,
    name: 'WineGuard 002',
    fiwareId: 'wine002',
    fiwareType: 'WineSensor002',
    fiwareService: 'vinheria',
    fiwareServicePath: '/',
    environmentId: environment.id,
    environmentName: environment.name,
    active: true,
  }
  const limit = { id: 12, deviceId: device.id, metric: 'TEMPERATURE', minimumValue: 10, maximumValue: 18, unit: '°C' }
  const calls = []

  await withFetch(async (url, options) => {
    calls.push({ url, options })
    const data = url === '/api/environments'
      ? options.method === 'POST' ? environment : [environment]
      : url === '/api/devices'
        ? options.method === 'POST' ? device : [device]
        : url.endsWith('/limits') && options.method === 'PUT' ? limit : [limit]
    return new Response(JSON.stringify(data), {
      status: options.method === 'POST' ? 201 : 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    assert.deepEqual(await getEnvironments(), [environment])
    assert.deepEqual(await createEnvironment({ name: 'Adega principal', description: 'Setor norte' }), environment)
    assert.deepEqual(await createEnvironment({ name: 'Adega sem descrição' }), environment)
    assert.deepEqual(await getDevices(), [device])
    assert.deepEqual(await createDevice({
      name: device.name,
      fiwareId: device.fiwareId,
      fiwareType: device.fiwareType,
      fiwareService: device.fiwareService,
      fiwareServicePath: device.fiwareServicePath,
      environmentId: device.environmentId,
    }), device)
    assert.deepEqual(await getDeviceLimits(device.id), [limit])
    assert.deepEqual(await saveDeviceLimit(device.id, {
      metric: limit.metric,
      minimumValue: limit.minimumValue,
      maximumValue: limit.maximumValue,
      unit: limit.unit,
    }), limit)
  })

  assert.deepEqual(calls.map(({ url, options }) => [url, options.method || 'GET']), [
    ['/api/environments', 'GET'],
    ['/api/environments', 'POST'],
    ['/api/environments', 'POST'],
    ['/api/devices', 'GET'],
    ['/api/devices', 'POST'],
    ['/api/devices/9/limits', 'GET'],
    ['/api/devices/9/limits', 'PUT'],
  ])
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: environment.name, description: environment.description })
  assert.deepEqual(JSON.parse(calls[2].options.body), { name: 'Adega sem descrição', description: null })
  assert.deepEqual(JSON.parse(calls[4].options.body), {
    name: device.name,
    fiwareId: device.fiwareId,
    fiwareType: device.fiwareType,
    fiwareService: device.fiwareService,
    fiwareServicePath: device.fiwareServicePath,
    environmentId: device.environmentId,
  })
  assert.equal(calls.every(({ options }) => options.credentials === 'same-origin'), true)
})

test('rejects invalid environment, device, and limit inputs before sending requests', async () => {
  await assert.rejects(createEnvironment({ name: ' ', description: null }), /nome válido/)
  await assert.rejects(createDevice({
    name: 'Sensor',
    fiwareId: 'wine002',
    fiwareType: 'WineSensor002',
    fiwareService: 'vinheria',
    fiwareServicePath: '/',
    environmentId: 0,
  }), /ambiente válido/)
  await assert.rejects(getDeviceLimits(0), /inteiro positivo/)
  await assert.rejects(saveDeviceLimit(1, {
    metric: 'TEMPERATURE',
    minimumValue: null,
    maximumValue: null,
    unit: '°C',
  }), /ao menos um limite válido/)
})
