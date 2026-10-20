const SENSOR_ID = 'WineSensor002'

async function getJson(path, signal) {
  let response
  try {
    response = await fetch(path, { headers: { Accept: 'application/json' }, signal })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Não foi possível conectar ao backend. Verifique a configuração do proxy e tente novamente.', { cause: error })
  }

  if (!response.ok) {
    throw new Error(`O backend respondeu com erro HTTP ${response.status}. Tente novamente.`)
  }

  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('A resposta não está em JSON. Verifique se o proxy /api está configurado para o backend.')
  }

  try {
    return await response.json()
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('O backend retornou uma resposta JSON inválida.', { cause: error })
  }
}

export async function getCurrentReadings(signal) {
  const data = await getJson(`/api/sensors/${SENSOR_ID}/readings`, signal)
  if (!data || typeof data !== 'object' || data.id !== SENSOR_ID || !('temperature' in data) || !('humidity' in data) || !('luminosity' in data) || !('measuredAt' in data)) {
    throw new Error('A resposta de leituras não corresponde ao formato esperado.')
  }
  return data
}

export async function getSensorHistory(attribute, limit = 20, signal) {
  const params = new URLSearchParams({ attribute, limit: String(limit) })
  const data = await getJson(`/api/sensors/${SENSOR_ID}/history?${params}`, signal)
  if (!data || typeof data !== 'object' || data.id !== SENSOR_ID || data.attribute !== attribute || !Array.isArray(data.points)) {
    throw new Error('A resposta do histórico não corresponde ao formato esperado.')
  }

  const points = data.points.map((point) => ({
    value: point.value,
    receivedAt: point.receivedAt,
    timestamp: Date.parse(point.receivedAt),
  }))
  if (points.some((point) => !Number.isFinite(point.value) || !Number.isFinite(point.timestamp))) {
    throw new Error('O histórico contém pontos inválidos.')
  }

  return points
}
