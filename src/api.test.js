import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApiError,
  createDevice,
  createDeviceConfiguration,
  createEnvironment,
  deleteDevice,
  getCsrfToken,
  getCurrentReadings,
  getDeviceConfiguration,
  getDeviceLimits,
  getDevices,
  getEnvironments,
  getSensorHistory,
  getSession,
  login,
  logout,
  provisionDevice,
  retryAndWatchDeviceConfiguration,
  retryDeviceConfiguration,
  saveDeviceLimit,
  sendDeviceAlert,
  subscribeToSessionExpiration,
  submitAndWatchDeviceConfiguration,
  validateDeviceConfigurationValues,
  watchDeviceConfiguration,
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

test('keeps the timeout active after immediate headers until the JSON body is read', async () => {
  await withFetch(async (_url, { signal }) => {
    const response = new Response(null, { headers: { 'content-type': 'application/json' } })
    response.json = () => new Promise((resolve, reject) => {
      const bodyTimer = setTimeout(() => resolve(currentFixture), 300)
      signal.addEventListener('abort', () => {
        clearTimeout(bodyTimer)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })
    return response
  }, async () => {
    await assert.rejects(getCurrentReadings({ timeoutMs: 100 }), (error) => error.name === 'TimeoutError')
  })
})

test('preserves caller cancellation while reading a JSON body', async () => {
  const controller = new AbortController()
  let bodyReadStarted
  const started = new Promise((resolve) => { bodyReadStarted = resolve })
  await withFetch(async (_url, { signal }) => {
    const response = new Response(null, { headers: { 'content-type': 'application/json' } })
    response.json = () => new Promise((_resolve, reject) => {
      bodyReadStarted()
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
    return response
  }, async () => {
    const request = getCurrentReadings({ signal: controller.signal, timeoutMs: 1000 })
    await started
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

test('uses CSRF-protected Java environment, device, and limit contracts', async () => {
  const environment = { id: 2, name: 'Adega principal', description: 'Setor norte' }
  const device = {
    id: 9,
    name: 'WineGuard 002',
    fiwareId: 'WineSensor002',
    mqttDeviceId: 'wine002',
    fiwareType: 'WineSensor002',
    fiwareService: 'vinheria',
    fiwareServicePath: '/',
    environmentId: environment.id,
    environmentName: environment.name,
    active: true,
  }
  const limit = { id: 12, deviceId: device.id, metric: 'TEMPERATURE', minimumValue: 10, maximumValue: 18, unit: '°C' }
  const csrf = { headerName: 'X-CSRF-TOKEN', token: 'csrf-in-memory' }
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
    assert.deepEqual(await createEnvironment({ name: 'Adega principal', description: 'Setor norte' }, csrf), environment)
    assert.deepEqual(await createEnvironment({ name: 'Adega sem descrição' }, csrf), environment)
    assert.deepEqual(await getDevices(), [device])
    assert.deepEqual(await createDevice({
      name: device.name,
      fiwareId: device.fiwareId,
      mqttDeviceId: device.mqttDeviceId,
      fiwareType: device.fiwareType,
      fiwareService: device.fiwareService,
      fiwareServicePath: device.fiwareServicePath,
      environmentId: device.environmentId,
    }, csrf), device)
    assert.deepEqual(await getDeviceLimits(device.id), [limit])
    assert.deepEqual(await saveDeviceLimit(device.id, {
      metric: limit.metric,
      minimumValue: limit.minimumValue,
      maximumValue: limit.maximumValue,
      unit: limit.unit,
    }, csrf), limit)
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
  assert.equal(calls[1].options.headers['X-CSRF-TOKEN'], csrf.token)
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: environment.name, description: environment.description })
  assert.deepEqual(JSON.parse(calls[2].options.body), { name: 'Adega sem descrição', description: null })
  assert.equal(calls[2].options.headers['X-CSRF-TOKEN'], csrf.token)
  assert.deepEqual(JSON.parse(calls[4].options.body), {
    name: device.name,
    fiwareId: device.fiwareId,
    mqttDeviceId: device.mqttDeviceId,
    fiwareType: device.fiwareType,
    fiwareService: device.fiwareService,
    fiwareServicePath: device.fiwareServicePath,
    environmentId: device.environmentId,
  })
  assert.equal(calls[4].options.headers['X-CSRF-TOKEN'], csrf.token)
  assert.equal(calls[6].options.headers['X-CSRF-TOKEN'], csrf.token)
  assert.equal(calls.every(({ options }) => options.credentials === 'same-origin'), true)
})

test('rejects invalid environment, device, and limit inputs before sending requests', async () => {
  await assert.rejects(createEnvironment({ name: ' ', description: null }), /nome válido/)
  await assert.rejects(createDevice({
    name: 'Sensor',
    fiwareId: 'wine002',
    mqttDeviceId: 'wine002',
    fiwareType: 'WineSensor002',
    fiwareService: 'vinheria',
    fiwareServicePath: '/',
    environmentId: 0,
  }), /ambiente válido/)
  await assert.rejects(createDevice({
    name: 'Sensor',
    fiwareId: 'WineSensor002',
    mqttDeviceId: 'not valid',
    fiwareType: 'WineSensor002',
    fiwareService: 'vinheria',
    fiwareServicePath: '/',
    environmentId: 1,
  }), /ID MQTT/)
  await assert.rejects(createDevice({
    name: 'Sensor',
    fiwareId: 'WineSensor002',
    fiwareType: 'WineSensor002',
    fiwareService: 'vinheria',
    fiwareServicePath: '/',
    environmentId: 1,
  }), /dados do dispositivo/)
  await assert.rejects(getDeviceLimits(0), /inteiro positivo/)
  await assert.rejects(saveDeviceLimit(1, {
    metric: 'TEMPERATURE',
    minimumValue: null,
    maximumValue: null,
    unit: '°C',
  }), /ao menos um limite válido/)
})

const csrfFixture = { headerName: 'X-CSRF-TOKEN', token: 'csrf-in-memory' }
const validConfigurationValues = {
  temperatureMin: 15,
  temperatureMax: 29,
  humidityMin: 40,
  humidityMax: 82,
  luminosityMax: 3500,
}

function configurationFixture(overrides = {}) {
  return {
    revision: 7,
    ...validConfigurationValues,
    state: 'PENDING',
    createdAt: '2026-10-13T19:31:56.582Z',
    confirmedAt: null,
    rejectionReason: null,
    ...overrides,
  }
}

test('sends CSRF on provision, delete, alert, and complete configuration writes', async () => {
  const calls = []
  await withFetch(async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/provision')) return new Response(null, { status: 201 })
    if (options.method === 'DELETE') return new Response(null, { status: 204 })
    if (url.endsWith('/commands/alert')) return new Response(null, { status: 202 })
    return new Response(JSON.stringify(configurationFixture()), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    await provisionDevice(9, csrfFixture)
    await deleteDevice(9, csrfFixture)
    await sendDeviceAlert(9, 'temperature', csrfFixture)
    await createDeviceConfiguration(9, validConfigurationValues, csrfFixture)
  })

  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ['/api/devices/9/provision', 'POST'],
    ['/api/devices/9', 'DELETE'],
    ['/api/devices/9/commands/alert', 'POST'],
    ['/api/devices/9/configuration', 'POST'],
  ])
  for (const { options } of calls) assert.equal(options.headers['X-CSRF-TOKEN'], csrfFixture.token)
  assert.equal(calls[0].options.body, undefined)
  assert.deepEqual(JSON.parse(calls[2].options.body), { command: 'temperature' })
  assert.deepEqual(JSON.parse(calls[3].options.body), validConfigurationValues)
})

test('accepts DELETE 204 without attempting to parse a response body', async () => {
  await withFetch(async (_url, options) => {
    assert.equal(options.method, 'DELETE')
    return new Response(null, { status: 204 })
  }, async () => {
    await assert.doesNotReject(deleteDevice(9, csrfFixture))
  })
})

test('validates complete ESP configuration bounds and decimal precision without rounding', async () => {
  assert.deepEqual(validateDeviceConfigurationValues(validConfigurationValues), validConfigurationValues)
  assert.deepEqual(validateDeviceConfigurationValues({
    ...validConfigurationValues,
    temperatureMin: -20,
    temperatureMax: -17.9,
    humidityMin: 0,
    humidityMax: 6.1,
    luminosityMax: 4095,
  }), {
    ...validConfigurationValues,
    temperatureMin: -20,
    temperatureMax: -17.9,
    humidityMin: 0,
    humidityMax: 6.1,
    luminosityMax: 4095,
  })
  for (const invalid of [
    { ...validConfigurationValues, temperatureMin: 15.01 },
    { ...validConfigurationValues, temperatureMax: 17 },
    { ...validConfigurationValues, humidityMin: 40.01 },
    { ...validConfigurationValues, humidityMax: 46 },
    { ...validConfigurationValues, luminosityMax: 3500.5 },
    { ...validConfigurationValues, luminosityMax: 199 },
  ]) {
    assert.throws(() => validateDeviceConfigurationValues(invalid), /Revise os limites/)
  }

  for (const [minimum, maximum] of [[15.1, 17.1], [15.1, 17], [40.1, 46.1], [40.1, 46]]) {
    assert.throws(() => validateDeviceConfigurationValues({
      ...validConfigurationValues,
      ...(minimum < 20
        ? { temperatureMin: minimum, temperatureMax: maximum }
        : { humidityMin: minimum, humidityMax: maximum }),
    }), /Revise os limites/)
  }
  assert.doesNotThrow(() => validateDeviceConfigurationValues({
    ...validConfigurationValues,
    temperatureMin: 15.1,
    temperatureMax: 17.2,
    humidityMin: 40.1,
    humidityMax: 46.2,
  }))
})

test('validates configuration states and returns confirmation metadata', async () => {
  const states = ['PENDING', 'APPLIED', 'REJECTED', 'UNCONFIRMED']
  await withFetch(async () => {
    const state = states.shift()
    const configuration = configurationFixture({
      state,
      confirmedAt: state === 'APPLIED' ? '2026-10-13T19:32:56.582Z' : null,
      rejectionReason: state === 'REJECTED' ? 'INVALID_CONFIGURATION' : null,
    })
    return new Response(JSON.stringify(configuration), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    const pending = await getDeviceConfiguration(9)
    assert.equal(pending.state, 'PENDING')
    const applied = await getDeviceConfiguration(9)
    assert.equal(applied.state, 'APPLIED')
    assert.equal(applied.confirmedAt, '2026-10-13T19:32:56.582Z')
    const rejected = await getDeviceConfiguration(9)
    assert.equal(rejected.rejectionReason, 'INVALID_CONFIGURATION')
    const unconfirmed = await getDeviceConfiguration(9)
    assert.equal(unconfirmed.state, 'UNCONFIRMED')
  })
})

test('watches for a late ESP confirmation using sequential GET requests', async () => {
  let activeRequests = 0
  let maximumActiveRequests = 0
  let reads = 0
  await withFetch(async () => {
    activeRequests += 1
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
    await new Promise((resolve) => setTimeout(resolve, 2))
    reads += 1
    activeRequests -= 1
    return new Response(JSON.stringify(configurationFixture(
      reads === 1
        ? { state: 'PENDING' }
        : { state: 'APPLIED', confirmedAt: '2026-10-13T19:32:56.582Z' },
    )), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    const result = await watchDeviceConfiguration(9, { intervalMs: 1, timeoutMs: 100 })
    assert.equal(result.state, 'APPLIED')
    assert.equal(result.confirmedAt, '2026-10-13T19:32:56.582Z')
  })
  assert.equal(reads, 2)
  assert.equal(maximumActiveRequests, 1)
})

test('does not repeat configuration POST after an ambiguous failure and reconciles by GET', async () => {
  let postCount = 0
  let getCount = 0
  await withFetch(async (_url, options) => {
    if (options.method === 'POST') {
      postCount += 1
      return new Response(JSON.stringify({ message: 'gateway timeout' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    }
    getCount += 1
    const state = getCount === 1 ? 'PENDING' : 'APPLIED'
    return new Response(JSON.stringify(configurationFixture({
      state,
      confirmedAt: state === 'APPLIED' ? '2026-10-13T19:32:56.582Z' : null,
    })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    const result = await submitAndWatchDeviceConfiguration(9, validConfigurationValues, csrfFixture, {
      intervalMs: 1,
      timeoutMs: 100,
    })
    assert.equal(result.state, 'APPLIED')
  })
  assert.equal(postCount, 1)
  assert.equal(getCount, 2)
})

test('reconciles an unexpected successful POST status without allowing a second write', async () => {
  let postCount = 0
  await withFetch(async (_url, options) => {
    if (options.method === 'POST') {
      postCount += 1
      return new Response(JSON.stringify(configurationFixture()), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(configurationFixture({
      state: 'APPLIED',
      confirmedAt: '2026-10-13T19:32:56.582Z',
    })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    const result = await submitAndWatchDeviceConfiguration(9, validConfigurationValues, csrfFixture)
    assert.equal(result.state, 'APPLIED')
  })
  assert.equal(postCount, 1)
})

test('does not treat an older applied revision as confirmation after a failed POST', async () => {
  let postCount = 0
  let getCount = 0
  await withFetch(async (_url, options) => {
    if (options.method === 'POST') {
      postCount += 1
      return new Response(JSON.stringify({ message: 'gateway timeout' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    }
    getCount += 1
    return new Response(JSON.stringify(configurationFixture({
      state: 'APPLIED',
      confirmedAt: '2026-10-13T19:32:56.582Z',
    })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    await assert.rejects(
      submitAndWatchDeviceConfiguration(9, validConfigurationValues, csrfFixture, {
        previousRevision: 7,
        intervalMs: 5000,
        timeoutMs: 250,
      }),
      (error) => error.name === 'ConfigurationOutcomeUnknownError',
    )
  })
  assert.equal(postCount, 1)
  assert.equal(getCount, 1)
})

test('cancels configuration polling without issuing another GET', async () => {
  const controller = new AbortController()
  let getCount = 0
  await withFetch(async () => {
    getCount += 1
    return new Response(JSON.stringify(configurationFixture()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    const watch = watchDeviceConfiguration(9, { signal: controller.signal, intervalMs: 100, timeoutMs: 1000 })
    controller.abort()
    await assert.rejects(watch, (error) => error.name === 'AbortError')
  })
  assert.equal(getCount, 0)
})

test('bounds configuration polling by the requested timeout, including an in-flight GET', async () => {
  let getCount = 0
  await withFetch((_url, { signal }) => {
    getCount += 1
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
  }, async () => {
    const startedAt = Date.now()
    await assert.rejects(
      watchDeviceConfiguration(9, { intervalMs: 1, timeoutMs: 20 }),
      (error) => error.name === 'TimeoutError',
    )
    assert.ok(Date.now() - startedAt < 100)
  })
  assert.equal(getCount, 1)
})

test('keeps configuration requests isolated by device id', async () => {
  const requestedUrls = []
  await withFetch(async (url) => {
    requestedUrls.push(url)
    return new Response(JSON.stringify(configurationFixture({ revision: Number(url.match(/devices\/(\d+)/)[1]) })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    const [deviceOne, deviceTwo] = await Promise.all([
      getDeviceConfiguration(1),
      getDeviceConfiguration(2),
    ])
    assert.equal(deviceOne.revision, 1)
    assert.equal(deviceTwo.revision, 2)
  })
  assert.deepEqual(requestedUrls.sort(), [
    '/api/devices/1/configuration',
    '/api/devices/2/configuration',
  ])
})

test('includes backend field validation details in API errors', async () => {
  await withFetch(async () => new Response(JSON.stringify({
    message: 'Dados inválidos',
    fieldErrors: { temperatureMin: ['deve ser maior ou igual a -20'] },
  }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  }), async () => {
    await assert.rejects(createDeviceConfiguration(9, validConfigurationValues, csrfFixture), (error) =>
      error instanceof ApiError &&
      error.status === 400 &&
      /temperatureMin: deve ser maior ou igual a -20/.test(error.message))
  })

  await withFetch(async () => new Response(JSON.stringify({
    detail: 'Revise os campos enviados.',
    status: 400,
    fields: { temperatureMin: 'mensagem de validação' },
  }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  }), async () => {
    await assert.rejects(createDeviceConfiguration(9, validConfigurationValues, csrfFixture), (error) =>
      error instanceof ApiError &&
      error.status === 400 &&
      /Revise os campos enviados/.test(error.message) &&
      /temperatureMin: mensagem de validação/.test(error.message))
  })
})

test('posts same-revision recovery with CSRF and no body', async () => {
  let call
  const applied = configurationFixture({ revision: 12, state: 'APPLIED' })
  await withFetch(async (url, options) => {
    call = { url, options }
    return new Response(JSON.stringify(applied), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    assert.deepEqual(await retryDeviceConfiguration(9, 12, csrfFixture), applied)
  })
  assert.equal(call.url, '/api/devices/9/configuration/12/retry')
  assert.equal(call.options.method, 'POST')
  assert.equal(call.options.headers['X-CSRF-TOKEN'], csrfFixture.token)
  assert.equal(call.options.body, undefined)
})

test('returns a 200 retry confirmation without starting another GET watch', async () => {
  const calls = []
  await withFetch(async (url, options) => {
    calls.push({ url, options })
    const configuration = options.method === 'POST'
      ? configurationFixture({ revision: 12, state: 'APPLIED' })
      : configurationFixture({ revision: 12, state: 'UNCONFIRMED' })
    return new Response(JSON.stringify(configuration), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    const result = await retryAndWatchDeviceConfiguration(9, 12, csrfFixture, {
      confirmRetry: () => true,
    })
    assert.equal(result.state, 'APPLIED')
  })
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method || 'GET']), [
    ['/api/devices/9/configuration', 'GET'],
    ['/api/devices/9/configuration/12/retry', 'POST'],
  ])
})

test('blocks a duplicate same-device retry before a second POST', async () => {
  let postCount = 0
  let confirmations = 0
  let releaseConfirmations
  const confirmationGate = new Promise((resolve) => { releaseConfirmations = resolve })
  await withFetch(async (_url, options) => {
    if (options.method === 'POST') postCount += 1
    const configuration = options.method === 'POST'
      ? configurationFixture({ revision: 12, state: 'APPLIED' })
      : configurationFixture({ revision: 12, state: 'UNCONFIRMED' })
    return new Response(JSON.stringify(configuration), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    const confirmRetry = async () => {
      confirmations += 1
      if (confirmations === 2) releaseConfirmations()
      await confirmationGate
      return true
    }
    const results = await Promise.allSettled([
      retryAndWatchDeviceConfiguration(9, 12, csrfFixture, { confirmRetry }),
      retryAndWatchDeviceConfiguration(9, 12, csrfFixture, { confirmRetry }),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  })
  assert.equal(postCount, 1)
})

test('follows a 202 same-revision retry with sequential GET polling', async () => {
  const calls = []
  let postCount = 0
  await withFetch(async (url, options) => {
    calls.push({ url, options })
    if (options.method === 'POST') {
      postCount += 1
      return new Response(JSON.stringify(configurationFixture({ revision: 12, state: 'PENDING' })), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      })
    }
    const state = calls.length > 2 ? 'APPLIED' : 'UNCONFIRMED'
    return new Response(JSON.stringify(configurationFixture({
      revision: 12,
      state,
      confirmedAt: state === 'APPLIED' ? '2026-10-13T19:32:56.582Z' : null,
    })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    const result = await retryAndWatchDeviceConfiguration(9, 12, csrfFixture, {
      confirmRetry: () => true,
      intervalMs: 1,
      timeoutMs: 100,
    })
    assert.equal(result.state, 'APPLIED')
  })
  assert.equal(postCount, 1)
  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/devices/9/configuration',
    '/api/devices/9/configuration/12/retry',
    '/api/devices/9/configuration',
  ])
})

test('does not automatically repeat an uncertain same-revision retry and consults state', async (context) => {
  await context.test('timeout', async () => {
    let postCount = 0
    let getCount = 0
    await withFetch(async (_url, options) => {
      if (options.method === 'POST') {
        postCount += 1
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      }
      getCount += 1
      return new Response(JSON.stringify(configurationFixture({ state: 'UNCONFIRMED' })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }, async () => {
      await assert.rejects(retryAndWatchDeviceConfiguration(9, 7, csrfFixture, {
        confirmRetry: () => true,
        timeoutMs: 100,
      }), (error) => error.name === 'TimeoutError')
    })
    assert.equal(postCount, 1)
    assert.equal(getCount, 2)
  })

  await context.test('502', async () => {
    let postCount = 0
    let getCount = 0
    await withFetch(async (_url, options) => {
      if (options.method === 'POST') {
        postCount += 1
        return new Response(JSON.stringify({ detail: 'Orion indisponível' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        })
      }
      getCount += 1
      return new Response(JSON.stringify(configurationFixture({ state: 'UNCONFIRMED' })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }, async () => {
      await assert.rejects(retryAndWatchDeviceConfiguration(9, 7, csrfFixture, {
        confirmRetry: () => true,
      }), (error) => error instanceof ApiError && error.status === 502)
    })
    assert.equal(postCount, 1)
    assert.equal(getCount, 2)
  })
})

test('surfaces retry conflicts without an automatic follow-up request', async () => {
  let postCount = 0
  let getCount = 0
  await withFetch(async (_url, options) => {
    if (options.method === 'POST') {
      postCount += 1
      return new Response(JSON.stringify({ detail: 'A revisão está bloqueada.' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      })
    }
    getCount += 1
    return new Response(JSON.stringify(configurationFixture({ state: 'UNCONFIRMED' })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    await assert.rejects(retryAndWatchDeviceConfiguration(9, 7, csrfFixture, {
      confirmRetry: () => true,
    }), (error) => error instanceof ApiError && error.status === 409)
  })
  assert.equal(postCount, 1)
  assert.equal(getCount, 1)
})

test('does not retry after preflight revision changes or state is not UNCONFIRMED', async (context) => {
  for (const configuration of [
    configurationFixture({ revision: 8, state: 'UNCONFIRMED' }),
    configurationFixture({ state: 'APPLIED' }),
    configurationFixture({ state: 'REJECTED', rejectionReason: 'INVALID_CONFIGURATION' }),
    configurationFixture({ state: 'PENDING' }),
  ]) {
    await context.test(`${configuration.state} revision ${configuration.revision}`, async () => {
      let postCount = 0
      let confirmationCount = 0
      await withFetch(async (_url, options) => {
        if (options.method === 'POST') {
          postCount += 1
          return new Response(JSON.stringify(configuration), {
            status: 202,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(JSON.stringify(configuration), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }, async () => {
        const latest = await retryAndWatchDeviceConfiguration(9, 7, csrfFixture, {
          confirmRetry: () => { confirmationCount += 1; return true },
        })
        assert.equal(latest.revision, configuration.revision)
      })
      assert.equal(postCount, 0)
      assert.equal(confirmationCount, 0)
    })
  }
})

test('cancels same-revision recovery before it can update the UI', async () => {
  const controller = new AbortController()
  const updatedDevices = []
  let requestUrl = ''
  let preflightStarted
  const started = new Promise((resolve) => { preflightStarted = resolve })
  await withFetch(async (url, { signal }) => {
    requestUrl = url
    preflightStarted()
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
  }, async () => {
    const recovery = retryAndWatchDeviceConfiguration(11, 7, csrfFixture, {
      signal: controller.signal,
      confirmRetry: () => true,
      onUpdate: () => updatedDevices.push(11),
    })
    await started
    controller.abort()
    await assert.rejects(recovery, (error) => error.name === 'AbortError')
  })
  assert.equal(requestUrl, '/api/devices/11/configuration')
  assert.deepEqual(updatedDevices, [])
})

test('keeps concurrent same-revision retries isolated by device id', async () => {
  const updatedByDevice = { 11: [], 12: [] }
  const requestedUrls = []
  await withFetch(async (url, options) => {
    requestedUrls.push(url)
    const state = options.method === 'POST' ? 'APPLIED' : 'UNCONFIRMED'
    return new Response(JSON.stringify(configurationFixture({
      revision: 7,
      state,
      confirmedAt: state === 'APPLIED' ? '2026-10-13T19:32:56.582Z' : null,
    })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    await Promise.all([11, 12].map((deviceId) => retryAndWatchDeviceConfiguration(deviceId, 7, csrfFixture, {
      confirmRetry: () => true,
      onUpdate: (configuration) => updatedByDevice[deviceId].push(configuration.state),
    })))
  })
  assert.deepEqual(requestedUrls.sort(), [
    '/api/devices/11/configuration',
    '/api/devices/11/configuration/7/retry',
    '/api/devices/12/configuration',
    '/api/devices/12/configuration/7/retry',
  ])
  assert.deepEqual(updatedByDevice, { 11: ['UNCONFIRMED', 'APPLIED'], 12: ['UNCONFIRMED', 'APPLIED'] })
})
