const SENSOR_ID = 'WineSensor002'
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_REFRESH_INTERVAL_MS = 30000

function readPositiveSetting(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const API_TIMEOUT_MS = readPositiveSetting(import.meta.env?.VITE_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
export const API_REFRESH_INTERVAL_MS = readPositiveSetting(import.meta.env?.VITE_API_REFRESH_INTERVAL_MS, DEFAULT_REFRESH_INTERVAL_MS)

const sessionExpirationListeners = new Set()

export class ApiError extends Error {
  constructor(message, status, payload = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

export function subscribeToSessionExpiration(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('O listener de expiração da sessão deve ser uma função.')
  }
  sessionExpirationListeners.add(listener)
  return () => sessionExpirationListeners.delete(listener)
}

function notifySessionExpired() {
  for (const listener of sessionExpirationListeners) listener()
}

function isValidTimestamp(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value))
}

function isNumberOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function validateEnvironment(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !Number.isInteger(data.id) || data.id < 1 ||
      typeof data.name !== 'string' || data.name.trim() === '' ||
      !(data.description === undefined || data.description === null || typeof data.description === 'string')) {
    throw new Error('A resposta do ambiente não corresponde ao formato esperado.')
  }
  return { id: data.id, name: data.name, description: data.description ?? null }
}

function validateDevice(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !Number.isInteger(data.id) || data.id < 1 ||
      typeof data.name !== 'string' || data.name.trim() === '' ||
      typeof data.fiwareId !== 'string' || data.fiwareId.trim() === '' ||
      typeof data.mqttDeviceId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(data.mqttDeviceId) ||
      typeof data.fiwareType !== 'string' || data.fiwareType.trim() === '' ||
      typeof data.fiwareService !== 'string' || data.fiwareService.trim() === '' ||
      typeof data.fiwareServicePath !== 'string' || data.fiwareServicePath.trim() === '' ||
      !Number.isInteger(data.environmentId) || data.environmentId < 1 ||
      typeof data.environmentName !== 'string' || typeof data.active !== 'boolean') {
    throw new Error('A resposta do dispositivo não corresponde ao formato esperado.')
  }
  return {
    id: data.id,
    name: data.name,
    fiwareId: data.fiwareId,
    mqttDeviceId: data.mqttDeviceId,
    fiwareType: data.fiwareType,
    fiwareService: data.fiwareService,
    fiwareServicePath: data.fiwareServicePath,
    environmentId: data.environmentId,
    environmentName: data.environmentName,
    active: data.active,
  }
}

const DEVICE_METRICS = ['TEMPERATURE', 'HUMIDITY', 'LUMINOSITY']

function validateLimit(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !Number.isInteger(data.id) || data.id < 1 ||
      !Number.isInteger(data.deviceId) || data.deviceId < 1 ||
      !DEVICE_METRICS.includes(data.metric) ||
      !isNumberOrNull(data.minimumValue) || !isNumberOrNull(data.maximumValue) ||
      typeof data.unit !== 'string' || data.unit.trim() === '') {
    throw new Error('A resposta do limite não corresponde ao formato esperado.')
  }
  return {
    id: data.id,
    deviceId: data.deviceId,
    metric: data.metric,
    minimumValue: data.minimumValue,
    maximumValue: data.maximumValue,
    unit: data.unit,
  }
}

function formatFieldErrors(errors) {
  if (!errors) return []
  if (Array.isArray(errors)) {
    return errors.map((error) => {
      if (typeof error === 'string') return error
      if (!error || typeof error !== 'object') return ''
      const field = error.field || error.property
      const message = error.message || error.defaultMessage || error.detail
      return field && message ? `${field}: ${message}` : String(message || '')
    }).filter(Boolean)
  }
  if (typeof errors === 'object') {
    return Object.entries(errors).flatMap(([field, messages]) =>
      (Array.isArray(messages) ? messages : [messages])
        .filter((message) => typeof message === 'string')
        .map((message) => `${field}: ${message}`))
  }
  return []
}

async function responseError(response) {
  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  const details = typeof payload === 'string'
    ? payload
    : payload && typeof payload === 'object'
      ? [payload.detail, payload.message, payload.title, payload.error].find((item) => typeof item === 'string' && item.trim() !== '')
      : ''
  const fieldErrors = formatFieldErrors(payload?.fieldErrors || payload?.errors || payload?.violations)
  const message = [
    `HTTP ${response.status}`,
    details,
    ...fieldErrors,
  ].filter(Boolean).join(': ')
  return new ApiError(message || `O backend respondeu com erro HTTP ${response.status}.`, response.status, payload)
}

async function request(path, { signal, timeoutMs = API_TIMEOUT_MS, protectedRequest = false, ...requestOptions } = {}) {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(signal.reason)
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(path, {
      ...requestOptions,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...requestOptions.headers },
      signal: controller.signal,
    })

    if (!response.ok) {
      if (protectedRequest && response.status === 401) notifySessionExpired()
      throw await responseError(response)
    }
    return response
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(`A consulta ao backend excedeu o limite de ${timeoutMs / 1000} segundos. Tente novamente.`, { cause: error })
      timeoutError.name = 'TimeoutError'
      throw timeoutError
    }
    if (signal?.aborted || error.name === 'AbortError') throw error
    if (error instanceof ApiError) throw error
    throw new Error('Não foi possível conectar ao backend. Verifique a configuração do proxy e tente novamente.', { cause: error })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

async function getJson(path, options, expectedStatus) {
  const response = await request(path, options)
  if (expectedStatus && response.status !== expectedStatus) {
    const statusError = new ApiError(`Resposta inesperada do backend (HTTP ${response.status}; esperado HTTP ${expectedStatus}).`, response.status)
    statusError.outcomeUnknown = response.ok
    throw statusError
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('A resposta não está em JSON. Verifique se o proxy /api está configurado para o backend.')
  }
  try {
    return await response.json()
  } catch (error) {
    if (options?.signal?.aborted || error.name === 'AbortError') throw error
    throw new Error('O backend retornou uma resposta JSON inválida.', { cause: error })
  }
}

function validateCsrfToken(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      typeof data.headerName !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(data.headerName) ||
      typeof data.token !== 'string' || data.token.trim() === '') {
    throw new Error('A resposta do token CSRF não corresponde ao formato esperado.')
  }
  return { headerName: data.headerName, token: data.token }
}

function requireCsrf(csrf) {
  if (!csrf?.headerName || !csrf?.token) {
    throw new Error('Não foi possível validar a solicitação protegida. Atualize o token CSRF e tente novamente.')
  }
  return { [csrf.headerName]: csrf.token }
}

function withCsrfHeaders(csrf, headers = {}) {
  return { ...headers, ...requireCsrf(csrf) }
}

const DEVICE_CONFIGURATION_STATES = ['PENDING', 'APPLIED', 'REJECTED', 'UNCONFIRMED']

function hasOneDecimalPlace(value) {
  return Number.isFinite(value) && Number(value.toFixed(1)) === value
}

export function validateDeviceConfigurationValues(configuration) {
  const { temperatureMin, temperatureMax, humidityMin, humidityMax, luminosityMax } = configuration || {}
  if (!hasOneDecimalPlace(temperatureMin) || temperatureMin < -20 || temperatureMin > 60 ||
      !hasOneDecimalPlace(temperatureMax) || temperatureMax < -20 || temperatureMax > 60 ||
      temperatureMax - temperatureMin <= 2 ||
      !hasOneDecimalPlace(humidityMin) || humidityMin < 0 || humidityMin > 100 ||
      !hasOneDecimalPlace(humidityMax) || humidityMax < 0 || humidityMax > 100 ||
      humidityMax - humidityMin <= 6 ||
      !Number.isInteger(luminosityMax) || luminosityMax < 200 || luminosityMax > 4095) {
    throw new Error('Revise os limites: temperatura de −20 a 60 °C (intervalo maior que 2 °C), umidade de 0 a 100% (intervalo maior que 6 pontos) e luminosidade inteira de 200 a 4095 ADC. Temperatura e umidade aceitam no máximo uma casa decimal.')
  }
  return { temperatureMin, temperatureMax, humidityMin, humidityMax, luminosityMax }
}

function validateDeviceConfiguration(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('A resposta da configuração do dispositivo não corresponde ao formato esperado.')
  }
  const revision = data.revision
  const state = String(data.state || data.status || '').toUpperCase()
  if (!((typeof revision === 'string' && revision.trim() !== '') || (Number.isInteger(revision) && revision > 0)) ||
      !DEVICE_CONFIGURATION_STATES.includes(state) ||
      !isValidTimestamp(data.createdAt) ||
      !(data.confirmedAt === null || (typeof data.confirmedAt === 'string' && isValidTimestamp(data.confirmedAt))) ||
      !(data.rejectionReason === null || data.rejectionReason === undefined || typeof data.rejectionReason === 'string')) {
    throw new Error('A resposta da configuração do dispositivo não corresponde ao formato esperado.')
  }
  const values = validateDeviceConfigurationValues(data)
  return {
    revision,
    ...values,
    state,
    createdAt: data.createdAt,
    confirmedAt: data.confirmedAt ?? null,
    rejectionReason: data.rejectionReason ?? null,
  }
}

function validateDeviceId(deviceId) {
  if (!Number.isInteger(deviceId) || deviceId < 1) {
    throw new Error('O identificador do dispositivo deve ser um inteiro positivo.')
  }
}

export async function getCsrfToken(options) {
  return validateCsrfToken(await getJson('/api/auth/csrf', options))
}

export async function login(username, password, csrf, options = {}) {
  if (typeof username !== 'string' || username.trim() === '' || typeof password !== 'string' || password === '') {
    throw new Error('Informe usuário e senha.')
  }
  if (!csrf?.headerName || !csrf?.token) {
    throw new Error('Não foi possível validar a solicitação de login. Tente novamente.')
  }

  const data = await getJson('/api/auth/login', {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      [csrf.headerName]: csrf.token,
    },
    body: new URLSearchParams({ username: username.trim(), password }),
  })
  if (data?.status !== 'authenticated') {
    throw new Error('A resposta de login não corresponde ao formato esperado.')
  }
}

export async function getSession(options) {
  const data = await getJson('/api/auth/me', options)
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.username !== 'string' || data.username.trim() === '') {
    throw new Error('A resposta da sessão não corresponde ao formato esperado.')
  }
  return { username: data.username }
}

export async function logout(csrf, options = {}) {
  if (!csrf?.headerName || !csrf?.token) {
    throw new Error('Não foi possível validar a solicitação de encerramento da sessão.')
  }
  const data = await getJson('/api/auth/logout', {
    ...options,
    method: 'POST',
    headers: { [csrf.headerName]: csrf.token },
  })
  if (data?.status !== 'logged_out') {
    throw new Error('A resposta de encerramento da sessão não corresponde ao formato esperado.')
  }
}

export async function getCurrentReadings(options) {
  const data = await getJson(`/api/sensors/${SENSOR_ID}/readings`, { ...options, protectedRequest: true })
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== SENSOR_ID || !('temperature' in data) || !('humidity' in data) || !('luminosity' in data) || !('measuredAt' in data)) {
    throw new Error('A resposta de leituras não corresponde ao formato esperado.')
  }
  if (!isNumberOrNull(data.temperature) || !isNumberOrNull(data.humidity) || !isNumberOrNull(data.luminosity) || !(data.measuredAt === null || isValidTimestamp(data.measuredAt))) {
    throw new Error('A resposta de leituras contém valores ou data inválidos.')
  }
  return data
}

export async function getSensorHistory(attribute, limit = 20, options) {
  if (!['temperature', 'humidity', 'luminosity'].includes(attribute)) {
    throw new Error('Atributo histórico inválido.')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('O limite do histórico deve ser um inteiro entre 1 e 100.')
  }
  const params = new URLSearchParams({ attribute, limit: String(limit) })
  const data = await getJson(`/api/sensors/${SENSOR_ID}/history?${params}`, { ...options, protectedRequest: true })
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== SENSOR_ID || data.attribute !== attribute || !Array.isArray(data.points)) {
    throw new Error('A resposta do histórico não corresponde ao formato esperado.')
  }

  if (!Number.isInteger(data.count) || data.count < 0 || data.count !== data.points.length) {
    throw new Error('A contagem do histórico não corresponde aos pontos retornados.')
  }
  const points = data.points.map((point) => {
    if (!point || typeof point !== 'object' || !isNumberOrNull(point.value) || !isValidTimestamp(point.receivedAt)) {
      throw new Error('O histórico contém pontos inválidos.')
    }
    return {
      value: point.value,
      receivedAt: point.receivedAt,
      timestamp: Date.parse(point.receivedAt),
    }
  })
  if (points.some((point) => point.value === null)) {
    throw new Error('O histórico contém pontos inválidos.')
  }

  return points
}

export async function getEnvironments(options) {
  const data = await getJson('/api/environments', { ...options, protectedRequest: true })
  if (!Array.isArray(data)) throw new Error('A resposta de ambientes não corresponde ao formato esperado.')
  return data.map(validateEnvironment)
}

export async function createEnvironment(environment, csrf, options) {
  if (!environment || typeof environment.name !== 'string' || environment.name.trim() === '' ||
      !(environment.description === undefined || environment.description === null || typeof environment.description === 'string')) {
    throw new Error('Informe um nome válido para o ambiente.')
  }
  return validateEnvironment(await getJson('/api/environments', {
    ...options,
    method: 'POST',
    headers: withCsrfHeaders(csrf, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: environment.name.trim(), description: environment.description?.trim() || null }),
    protectedRequest: true,
  }))
}

export async function getDevices(options) {
  const data = await getJson('/api/devices', { ...options, protectedRequest: true })
  if (!Array.isArray(data)) throw new Error('A resposta de dispositivos não corresponde ao formato esperado.')
  return data.map(validateDevice)
}

export async function createDevice(device, csrf, options) {
  if (!device || ['name', 'fiwareId', 'fiwareType', 'fiwareService', 'fiwareServicePath', 'mqttDeviceId'].some((key) =>
    typeof device[key] !== 'string' || device[key].trim() === '') ||
      !Number.isInteger(device.environmentId) || device.environmentId < 1) {
    throw new Error('Preencha os dados do dispositivo e selecione um ambiente válido.')
  }
  const mqttDeviceId = device.mqttDeviceId.trim()
  if (mqttDeviceId.length < 1 || mqttDeviceId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(mqttDeviceId)) {
    throw new Error('O ID MQTT deve ter de 1 a 100 caracteres: letras, números, hífen ou sublinhado.')
  }
  return validateDevice(await getJson('/api/devices', {
    ...options,
    method: 'POST',
    headers: withCsrfHeaders(csrf, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: device.name.trim(),
      fiwareId: device.fiwareId.trim(),
      fiwareType: device.fiwareType.trim(),
      fiwareService: device.fiwareService.trim(),
      fiwareServicePath: device.fiwareServicePath.trim(),
      mqttDeviceId,
      environmentId: device.environmentId,
    }),
    protectedRequest: true,
  }))
}

export async function getDeviceLimits(deviceId, options) {
  validateDeviceId(deviceId)
  const data = await getJson(`/api/devices/${deviceId}/limits`, { ...options, protectedRequest: true })
  if (!Array.isArray(data)) throw new Error('A resposta de limites não corresponde ao formato esperado.')
  return data.map(validateLimit)
}

export async function saveDeviceLimit(deviceId, limit, csrf, options) {
  validateDeviceId(deviceId)
  if (!limit || !DEVICE_METRICS.includes(limit.metric) ||
      !(limit.minimumValue === null || (typeof limit.minimumValue === 'number' && Number.isFinite(limit.minimumValue))) ||
      !(limit.maximumValue === null || (typeof limit.maximumValue === 'number' && Number.isFinite(limit.maximumValue))) ||
      (limit.minimumValue === null && limit.maximumValue === null) ||
      (limit.minimumValue !== null && limit.maximumValue !== null && limit.minimumValue > limit.maximumValue) ||
      typeof limit.unit !== 'string' || limit.unit.trim() === '') {
    throw new Error('Informe ao menos um limite válido e sua unidade.')
  }
  return validateLimit(await getJson(`/api/devices/${deviceId}/limits`, {
    ...options,
    method: 'PUT',
    headers: withCsrfHeaders(csrf, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      metric: limit.metric,
      minimumValue: limit.minimumValue,
      maximumValue: limit.maximumValue,
      unit: limit.unit.trim(),
    }),
    protectedRequest: true,
  }))
}

export async function provisionDevice(deviceId, csrf, options) {
  validateDeviceId(deviceId)
  const response = await request(`/api/devices/${deviceId}/provision`, {
    ...options,
    method: 'POST',
    headers: withCsrfHeaders(csrf),
    protectedRequest: true,
  })
  if (response.status !== 201) {
    throw new ApiError(`Resposta inesperada ao provisionar dispositivo (HTTP ${response.status}).`, response.status)
  }
}

export async function deleteDevice(deviceId, csrf, options) {
  validateDeviceId(deviceId)
  const response = await request(`/api/devices/${deviceId}`, {
    ...options,
    method: 'DELETE',
    headers: withCsrfHeaders(csrf),
    protectedRequest: true,
  })
  if (response.status !== 204) {
    throw new ApiError(`Resposta inesperada ao remover dispositivo (HTTP ${response.status}).`, response.status)
  }
}

const ALERT_COMMANDS = ['normal', 'temperature', 'humidity', 'luminosity']

export async function sendDeviceAlert(deviceId, command, csrf, options) {
  validateDeviceId(deviceId)
  if (!ALERT_COMMANDS.includes(command)) {
    throw new Error('Comando de alerta inválido.')
  }
  const response = await request(`/api/devices/${deviceId}/commands/alert`, {
    ...options,
    method: 'POST',
    headers: withCsrfHeaders(csrf, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ command }),
    protectedRequest: true,
  })
  if (response.status !== 202) {
    throw new ApiError(`Resposta inesperada ao enviar comando de alerta (HTTP ${response.status}).`, response.status)
  }
}

export async function getDeviceConfiguration(deviceId, options) {
  validateDeviceId(deviceId)
  return validateDeviceConfiguration(await getJson(`/api/devices/${deviceId}/configuration`, {
    ...options,
    protectedRequest: true,
  }))
}

export async function createDeviceConfiguration(deviceId, values, csrf, options) {
  validateDeviceId(deviceId)
  const configuration = validateDeviceConfigurationValues(values)
  let data
  try {
    data = await getJson(`/api/devices/${deviceId}/configuration`, {
      ...options,
      method: 'POST',
      headers: withCsrfHeaders(csrf, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(configuration),
      protectedRequest: true,
    }, 202)
  } catch (error) {
    if (!(error instanceof ApiError) || error.outcomeUnknown) error.outcomeUnknown = true
    throw error
  }
  let saved
  try {
    saved = validateDeviceConfiguration(data)
  } catch (error) {
    error.outcomeUnknown = true
    throw error
  }
  if (saved.state !== 'PENDING') {
    const stateError = new Error('A API aceitou a configuração em um estado diferente de PENDING.')
    stateError.outcomeUnknown = true
    throw stateError
  }
  return saved
}

function isUncertainConfigurationRequestError(error) {
  return error.outcomeUnknown === true ||
    error.name === 'TimeoutError' ||
    (error instanceof ApiError && [409, 502, 503].includes(error.status)) ||
    error.message.startsWith('Não foi possível conectar ao backend.')
}

function isConfigurationTerminal(configuration) {
  return configuration.state === 'APPLIED' || configuration.state === 'REJECTED'
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function watchDeviceConfiguration(deviceId, {
  signal,
  intervalMs = 5000,
  timeoutMs = 45000,
  onUpdate,
  expectedRevision,
  matches = () => true,
} = {}) {
  validateDeviceId(deviceId)
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Os intervalos de acompanhamento da configuração devem ser positivos.')
  }
  const startedAt = Date.now()
  let latestMatching = null
  while (Date.now() - startedAt < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - startedAt)
    await delay(Math.min(intervalMs, remaining), signal)
    const requestTimeRemaining = timeoutMs - (Date.now() - startedAt)
    if (requestTimeRemaining <= 0) break
    const latest = await getDeviceConfiguration(deviceId, { signal, timeoutMs: requestTimeRemaining })
    const revisionMatches = expectedRevision === undefined ||
      String(latest.revision) === String(expectedRevision)
    if (!revisionMatches || !matches(latest)) continue
    latestMatching = latest
    onUpdate?.(latest)
    if (isConfigurationTerminal(latest)) return latest
  }
  if (latestMatching) return latestMatching
  const unknownError = new Error('A API ainda não retornou a revisão correspondente a esta solicitação.')
  unknownError.name = 'ConfigurationOutcomeUnknownError'
  throw unknownError
}

export async function submitAndWatchDeviceConfiguration(deviceId, values, csrf, {
  signal,
  intervalMs = 5000,
  timeoutMs = 45000,
  onUpdate,
  onUncertain,
  previousRevision,
} = {}) {
  validateDeviceId(deviceId)
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Os intervalos de acompanhamento da configuração devem ser positivos.')
  }
  const startedAt = Date.now()
  const getRemainingTime = () => timeoutMs - (Date.now() - startedAt)
  const watchRemainingTime = (options) => {
    const remaining = getRemainingTime()
    if (remaining <= 0) {
      const unknownError = new Error('O prazo de 45 segundos terminou antes da confirmação desta revisão.')
      unknownError.name = 'ConfigurationOutcomeUnknownError'
      throw unknownError
    }
    return watchDeviceConfiguration(deviceId, {
      signal,
      intervalMs,
      timeoutMs: remaining,
      ...options,
    })
  }
  const sameValues = (configuration) =>
    Object.entries(values).every(([field, value]) => configuration[field] === value)
  const isNewConfiguration = (configuration) =>
    sameValues(configuration) &&
    (previousRevision === undefined || String(configuration.revision) !== String(previousRevision))
  let initial
  try {
    initial = await createDeviceConfiguration(deviceId, values, csrf, {
      signal,
      timeoutMs: Math.min(API_TIMEOUT_MS, timeoutMs),
    })
  } catch (error) {
    if (!isUncertainConfigurationRequestError(error)) throw error
    onUncertain?.()
    try {
      const remaining = getRemainingTime()
      initial = await getDeviceConfiguration(deviceId, {
        signal,
        timeoutMs: remaining > 0 ? remaining : API_TIMEOUT_MS,
      })
    } catch (verificationError) {
      if (verificationError.name === 'AbortError' || (verificationError instanceof ApiError && verificationError.status === 401)) {
        throw verificationError
      }
      const unknownError = new Error(`O resultado do envio é desconhecido. A consulta de estado também falhou: ${verificationError.message}`, { cause: verificationError })
      unknownError.name = 'ConfigurationOutcomeUnknownError'
      throw unknownError
    }
    if (!isNewConfiguration(initial)) {
      try {
        return await watchRemainingTime({
          matches: isNewConfiguration,
          onUpdate,
        })
      } catch (watchError) {
        if (watchError.name === 'AbortError' || (watchError instanceof ApiError && watchError.status === 401)) throw watchError
        const unknownError = new Error(`O resultado do envio é desconhecido. Não foi possível confirmar uma nova revisão: ${watchError.message}`, { cause: watchError })
        unknownError.name = 'ConfigurationOutcomeUnknownError'
        throw unknownError
      }
    }
    onUpdate?.(initial)
    if (isConfigurationTerminal(initial)) return initial
    try {
      return await watchRemainingTime({
        expectedRevision: initial.revision,
        onUpdate,
      })
    } catch (watchError) {
      if (watchError.name === 'AbortError' || (watchError instanceof ApiError && watchError.status === 401)) throw watchError
      const unknownError = new Error(`O envio foi aceito ou pode ter sido aceito, mas não foi possível confirmar o estado: ${watchError.message}`, { cause: watchError })
      unknownError.name = 'ConfigurationOutcomeUnknownError'
      throw unknownError
    }
  }
  onUpdate?.(initial)
  if (isConfigurationTerminal(initial)) return initial
  try {
    return await watchRemainingTime({
      expectedRevision: initial.revision,
      onUpdate,
    })
  } catch (watchError) {
    if (watchError.name === 'AbortError' || (watchError instanceof ApiError && watchError.status === 401)) throw watchError
    const unknownError = new Error(`A configuração foi enviada, mas não foi possível confirmar o estado: ${watchError.message}`, { cause: watchError })
    unknownError.name = 'ConfigurationOutcomeUnknownError'
    throw unknownError
  }
}
