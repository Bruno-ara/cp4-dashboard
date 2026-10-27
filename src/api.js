const SENSOR_ID = 'WineSensor002'
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_REFRESH_INTERVAL_MS = 30000

function readPositiveSetting(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const API_TIMEOUT_MS = readPositiveSetting(import.meta.env?.VITE_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
export const API_REFRESH_INTERVAL_MS = readPositiveSetting(import.meta.env?.VITE_API_REFRESH_INTERVAL_MS, DEFAULT_REFRESH_INTERVAL_MS)

function isValidTimestamp(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value))
}

function isNumberOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

async function getJson(path, { signal, timeoutMs = API_TIMEOUT_MS } = {}) {
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
    const response = await fetch(path, { headers: { Accept: 'application/json' }, signal: controller.signal })

    if (!response.ok) {
      throw new Error(`O backend respondeu com erro HTTP ${response.status}. Tente novamente.`)
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
    if (error.message.startsWith('O backend respondeu com erro HTTP') || error.message.startsWith('A resposta não está em JSON') || error.message.startsWith('O backend retornou uma resposta JSON inválida')) throw error
    throw new Error('Não foi possível conectar ao backend. Verifique a configuração do proxy e tente novamente.', { cause: error })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
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
