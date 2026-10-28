const SENSOR_ID = 'WineSensor002'
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_REFRESH_INTERVAL_MS = 30000

function readPositiveSetting(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const API_TIMEOUT_MS = readPositiveSetting(import.meta.env?.VITE_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
export const API_REFRESH_INTERVAL_MS = readPositiveSetting(import.meta.env?.VITE_API_REFRESH_INTERVAL_MS, DEFAULT_REFRESH_INTERVAL_MS)

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function isValidTimestamp(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value))
}

function isNumberOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

async function getJson(path, { signal, timeoutMs = API_TIMEOUT_MS, ...requestOptions } = {}) {
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
      throw new ApiError(`O backend respondeu com erro HTTP ${response.status}. Tente novamente.`, response.status)
    }

    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('A resposta não está em JSON. Verifique se o proxy /api está configurado para o backend.')
    }

    try {
      return await response.json()
    } catch (error) {
      if (timedOut) throw error
      if (signal?.aborted || error.name === 'AbortError') throw error
      throw new Error('O backend retornou uma resposta JSON inválida.', { cause: error })
    }
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(`A consulta ao backend excedeu o limite de ${timeoutMs / 1000} segundos. Tente novamente.`, { cause: error })
      timeoutError.name = 'TimeoutError'
      throw timeoutError
    }
    if (signal?.aborted || error.name === 'AbortError') throw error
    if (error instanceof ApiError || error.message.startsWith('A resposta não está em JSON') || error.message.startsWith('O backend retornou uma resposta JSON inválida')) throw error
    throw new Error('Não foi possível conectar ao backend. Verifique a configuração do proxy e tente novamente.', { cause: error })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
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
  const data = await getJson(`/api/sensors/${SENSOR_ID}/readings`, options)
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
  const data = await getJson(`/api/sensors/${SENSOR_ID}/history?${params}`, options)
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
