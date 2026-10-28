import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_REFRESH_INTERVAL_MS, ApiError, createDevice, createEnvironment, getCsrfToken, getCurrentReadings, getDeviceLimits, getDevices, getEnvironments, getSensorHistory, getSession, login, logout as endSession, saveDeviceLimit, subscribeToSessionExpiration } from './api.js'
import VineyardMap, { VineyardDetails } from './VineyardMap.jsx'

const metrics = {
  temperature: { label: 'Temperatura', unit: '°C', color: '#914559', fill: '#f8edf0', icon: 'temperature' },
  humidity: { label: 'Umidade', unit: '%', color: '#578be8', fill: '#eef4ff', icon: 'humidity' },
  luminosity: { label: 'Luminosidade', unit: '', color: '#e4a923', fill: '#fff8e7', icon: 'sun' },
}

const deviceMetrics = {
  TEMPERATURE: { label: 'Temperatura' },
  HUMIDITY: { label: 'Umidade' },
  LUMINOSITY: { label: 'Luminosidade' },
}

const formatValue = (value, digits = 1) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Indisponível'
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value)
}

const formatTimestamp = (value, options = {}) => {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', {
    year: 'numeric',
    month: options.dateOnly ? 'short' : '2-digit',
    day: '2-digit',
    hour: options.dateOnly ? undefined : '2-digit',
    minute: options.dateOnly ? undefined : '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value))
}

function Icon({ name, size = 20, strokeWidth = 1.8 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
    devices: <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 17h6M10 6h4" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m7 14 4-4 4 3 6-7" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4L7.5 15a8 8 0 0 1 0-1.9L6.1 12l1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 1.9Z" transform="translate(-1 -1)" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    down: <path d="m7 10 5 5 5-5" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    wifi: <><path d="M5 12.5a11 11 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0M11 18.5a2 2 0 0 1 2 0" /><path d="M12 21h.01" /></>,
    battery: <><rect x="3" y="7" width="17" height="10" rx="2" /><path d="M23 10v4M7 10v4" /></>,
    temperature: <><path d="M14 14.8V5a3 3 0 0 0-6 0v9.8a5 5 0 1 0 6 0Z" /><path d="M11 11v6" /></>,
    humidity: <><path d="M12 22a7 7 0 0 0 7-7c0-4-7-13-7-13S5 11 5 15a7 7 0 0 0 7 7Z" /><path d="M9 16a3 3 0 0 0 3 3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    zap: <path d="m13 2-3 8h7l-6 12 2-9H6l7-11Z" />,
    grapes: <><path d="M12 4c0-2 1.5-3 3-3M12 5c-2-1-4 0-4 2" /><path d="M12 5c2-1 4 0 4 2" /><circle cx="9" cy="9" r="2.2" /><circle cx="15" cy="9" r="2.2" /><circle cx="7.5" cy="13" r="2.2" /><circle cx="12" cy="13" r="2.2" /><circle cx="16.5" cy="13" r="2.2" /><circle cx="10" cy="17" r="2.2" /><circle cx="14" cy="17" r="2.2" /><circle cx="12" cy="20" r="2" /></>,
  }
  return <svg {...common}>{paths[name] || paths.grid}</svg>
}

function HistoryChart({ points, metric }) {
  const config = metrics[metric]
  const width = 720
  const height = 218
  const pad = { top: 12, right: 12, bottom: 32, left: 42 }
  const values = points.map((point) => point.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const verticalPadding = maxValue === minValue ? Math.max(Math.abs(maxValue) * 0.05, 1) : (maxValue - minValue) * 0.12
  const min = minValue - verticalPadding
  const max = maxValue + verticalPadding
  const start = points[0].timestamp
  const end = points[points.length - 1].timestamp
  const duration = end - start
  const chartWidth = width - pad.left - pad.right
  const pointsForChart = points.map((point, index) => ({
    ...point,
    x: duration === 0 ? pad.left + (index / Math.max(points.length - 1, 1)) * chartWidth : pad.left + ((point.timestamp - start) / duration) * chartWidth,
    y: pad.top + ((max - point.value) / (max - min)) * (height - pad.top - pad.bottom),
  }))
  const line = pointsForChart.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const area = `${line} L ${pointsForChart[pointsForChart.length - 1].x} ${height - pad.bottom} L ${pointsForChart[0].x} ${height - pad.bottom} Z`
  const labelCount = Math.min(points.length, 5)
  const labelIndexes = Array.from({ length: labelCount }, (_, index) => Math.round(index * (points.length - 1) / Math.max(labelCount - 1, 1)))

  return (
    <svg className="history-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Histórico real de ${config.label.toLowerCase()}, eixo horizontal por horário de recebimento e vertical por valor`}>
      <defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={config.color} stopOpacity=".18" /><stop offset="100%" stopColor={config.color} stopOpacity="0" /></linearGradient></defs>
      {[0, 1, 2, 3].map((row) => {
        const y = pad.top + (row / 3) * (height - pad.top - pad.bottom)
        return <g key={row}><line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="#edf0f4" strokeDasharray="4 5" /><text x="0" y={y + 4} className="axis-label">{formatValue(max - ((max - min) * row) / 3, 1)}</text></g>
      })}
      <path d={area} fill="url(#chart-fill)" />
      <path d={line} fill="none" stroke={config.color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      {pointsForChart.map((point, index) => <circle key={`${point.receivedAt}-${index}`} cx={point.x} cy={point.y} r={points.length === 1 ? 4 : 2.5} fill={config.color} stroke="white" strokeWidth="1.5"><title>{`${formatTimestamp(point.receivedAt)} · ${formatValue(point.value)}`}</title></circle>)}
      {labelIndexes.map((index) => <text key={`${points[index].receivedAt}-${index}`} x={pointsForChart[index].x} y={height - 3} className="axis-label" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(points[index].timestamp))}</text>)}
    </svg>
  )
}

function RequestMessage({ loading, error, empty, onRetry, label }) {
  if (loading) return <div className="request-message" role="status">Carregando {label}…</div>
  if (error) return <div className="request-message request-error" role="alert"><span>{error}</span><button className="retry-button" onClick={onRetry}>Tentar novamente</button></div>
  if (empty) return <div className="request-message">Ainda não há {label} disponíveis.</div>
  return null
}

function LoginScreen({ onLogin, error, busy }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    if (await onLogin(username, password)) setPassword('')
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand"><span className="brand-mark"><Icon name="grapes" size={22} /></span><span>wineguard<span className="brand-dot">.</span></span></div>
        <p className="auth-eyebrow">PAINEL DE MONITORAMENTO</p>
        <h1 id="login-title">Acesse sua conta</h1>
        <p className="auth-description">Entre com as credenciais fornecidas pelo responsável pelo backend.</p>
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="login-username">Usuário</label>
          <input id="login-username" name="username" type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required disabled={busy} />
          <label htmlFor="login-password">Senha</label>
          <input id="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="auth-footnote">Não há cadastro público nem recuperação de senha. Solicite acesso à equipe responsável.</p>
      </section>
    </main>
  )
}

function LimitEditor({ deviceId, metric, current, busy, onSave }) {
  const [minimum, setMinimum] = useState(current?.minimumValue === null || current?.minimumValue === undefined ? '' : String(current.minimumValue))
  const [maximum, setMaximum] = useState(current?.maximumValue === null || current?.maximumValue === undefined ? '' : String(current.maximumValue))
  const [unit, setUnit] = useState(current?.unit || '')
  const [error, setError] = useState('')

  const submit = (event) => {
    event.preventDefault()
    const minimumValue = minimum === '' ? null : Number(minimum)
    const maximumValue = maximum === '' ? null : Number(maximum)
    if ((minimum !== '' && !Number.isFinite(minimumValue)) ||
        (maximum !== '' && !Number.isFinite(maximumValue)) ||
        (minimumValue === null && maximumValue === null) ||
        (minimumValue !== null && maximumValue !== null && minimumValue > maximumValue) ||
        unit.trim() === '') {
      setError('Informe ao menos um valor válido, uma unidade e uma faixa não invertida.')
      return
    }
    setError('')
    onSave(deviceId, { metric, minimumValue, maximumValue, unit })
  }

  return (
    <form className="limit-editor" onSubmit={submit}>
      <div className="limit-editor-heading"><strong>{deviceMetrics[metric].label}</strong><span>{current ? 'Configurado' : 'Sem limite'}</span></div>
      <div className="management-fields limit-fields">
        <label>Mínimo<input type="number" step="any" value={minimum} onChange={(event) => setMinimum(event.target.value)} aria-label={`${deviceMetrics[metric].label}: mínimo`} /></label>
        <label>Máximo<input type="number" step="any" value={maximum} onChange={(event) => setMaximum(event.target.value)} aria-label={`${deviceMetrics[metric].label}: máximo`} /></label>
        <label>Unidade<input value={unit} maxLength={20} onChange={(event) => setUnit(event.target.value)} required aria-label={`${deviceMetrics[metric].label}: unidade`} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="secondary-button limit-save" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar limite'}</button>
    </form>
  )
}

function App() {
  const [authStatus, setAuthStatus] = useState('checking')
  const [user, setUser] = useState(null)
  const [csrf, setCsrf] = useState(null)
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [logoutRetryAllowed, setLogoutRetryAllowed] = useState(true)
  const [sessionWarning, setSessionWarning] = useState('')
  const [readings, setReadings] = useState(null)
  const [readingsError, setReadingsError] = useState('')
  const [readingsLoading, setReadingsLoading] = useState(true)
  const [readingsRetry, setReadingsRetry] = useState(0)
  const [metric, setMetric] = useState('temperature')
  const [history, setHistory] = useState([])
  const [historyAttribute, setHistoryAttribute] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyRetry, setHistoryRetry] = useState(0)
  const [historyUpdatedAt, setHistoryUpdatedAt] = useState(null)
  const [historyUpdatedMetric, setHistoryUpdatedMetric] = useState('')
  const [environments, setEnvironments] = useState([])
  const [environmentsLoading, setEnvironmentsLoading] = useState(true)
  const [environmentsError, setEnvironmentsError] = useState('')
  const [environmentsRetry, setEnvironmentsRetry] = useState(0)
  const [environmentForm, setEnvironmentForm] = useState({ name: '', description: '' })
  const [environmentBusy, setEnvironmentBusy] = useState(false)
  const [environmentSaveError, setEnvironmentSaveError] = useState('')
  const [environmentSaveSuccess, setEnvironmentSaveSuccess] = useState('')
  const [devices, setDevices] = useState([])
  const [devicesLoading, setDevicesLoading] = useState(true)
  const [devicesError, setDevicesError] = useState('')
  const [devicesRetry, setDevicesRetry] = useState(0)
  const [deviceForm, setDeviceForm] = useState({
    name: '',
    fiwareId: '',
    fiwareType: '',
    fiwareService: '',
    fiwareServicePath: '',
    environmentId: '',
  })
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [deviceSaveError, setDeviceSaveError] = useState('')
  const [deviceSaveSuccess, setDeviceSaveSuccess] = useState('')
  const [selectedLimitDevice, setSelectedLimitDevice] = useState(null)
  const [deviceLimits, setDeviceLimits] = useState([])
  const [limitsLoading, setLimitsLoading] = useState(false)
  const [limitsError, setLimitsError] = useState('')
  const [limitsRetry, setLimitsRetry] = useState(0)
  const [limitBusy, setLimitBusy] = useState(false)
  const [limitSaveError, setLimitSaveError] = useState('')
  const [limitSaveSuccess, setLimitSaveSuccess] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [selectedVineyard, setSelectedVineyard] = useState(null)
  const vineyardTriggerRef = useRef(null)
  const sessionExpiredRef = useRef(false)
  const lastSessionCheckRef = useRef(0)

  const handleSessionExpiration = useCallback(() => {
    if (sessionExpiredRef.current) return
    sessionExpiredRef.current = true
    setUser(null)
    setCsrf(null)
    setAuthStatus('anonymous')
    setAuthError('Sua sessão expirou. Entre novamente.')
  }, [])

  const checkSession = useCallback(async (options = {}) => {
    try {
      const session = await getSession(options)
      const token = await getCsrfToken(options)
      sessionExpiredRef.current = false
      lastSessionCheckRef.current = Date.now()
      setUser(session)
      setCsrf(token)
      setAuthStatus('authenticated')
    } catch (error) {
      if (options.signal?.aborted || error.name === 'AbortError') return
      setUser(null)
      setCsrf(null)
      if (error instanceof ApiError && error.status === 401) {
        setAuthStatus('anonymous')
        setAuthError('')
      } else if (error instanceof ApiError && error.status === 403) {
        setAuthStatus('error')
        setAuthError('Acesso negado pelo backend ao verificar a sessão (HTTP 403).')
      } else {
        setAuthStatus('error')
        setAuthError(error.message)
      }
    }
  }, [])

  useEffect(() => subscribeToSessionExpiration(handleSessionExpiration), [handleSessionExpiration])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => checkSession({ signal: controller.signal }), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [checkSession])

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined
    let active = true
    let inFlight = false
    let wasHidden = document.visibilityState === 'hidden'
    let controller

    const revalidateSession = async (afterHidden = false) => {
      if (document.visibilityState === 'hidden') {
        wasHidden = true
        return
      }
      if (inFlight || (!afterHidden && Date.now() - lastSessionCheckRef.current < 60000)) return
      inFlight = true
      lastSessionCheckRef.current = Date.now()
      controller = new AbortController()
      try {
        await getSession({ signal: controller.signal })
        if (active) {
          setSessionWarning('')
          setReadingsRetry((current) => current + 1)
          setHistoryRetry((current) => current + 1)
        }
      } catch (error) {
        if (!active || error.name === 'AbortError') return
        if (error instanceof ApiError && error.status === 401) {
          handleSessionExpiration()
        } else {
          setSessionWarning(`Não foi possível revalidar a sessão: ${error.message}`)
        }
      } finally {
        inFlight = false
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden = true
      } else if (wasHidden) {
        wasHidden = false
        revalidateSession(true)
      }
    }
    const handleWindowFocus = () => revalidateSession()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
      controller?.abort()
    }
  }, [authStatus, handleSessionExpiration])

  const retrySessionCheck = () => {
    setAuthStatus('checking')
    setAuthError('')
    checkSession()
  }

  const handleLogin = async (username, password) => {
    setAuthBusy(true)
    setAuthError('')
    let loginSucceeded = false
    try {
      const initialToken = await getCsrfToken()
      await login(username, password, initialToken)
      loginSucceeded = true
      const refreshedToken = await getCsrfToken()
      const session = await getSession()
      sessionExpiredRef.current = false
      lastSessionCheckRef.current = Date.now()
      setSessionWarning('')
      setEnvironmentsLoading(true)
      setDevicesLoading(true)
      setUser(session)
      setCsrf(refreshedToken)
      setAuthStatus('authenticated')
      return true
    } catch (error) {
      setAuthStatus(loginSucceeded ? 'error' : 'anonymous')
      if (error instanceof ApiError && error.status === 401) {
        setAuthError('Usuário ou senha inválidos.')
      } else if (error instanceof ApiError && error.status === 403) {
        setAuthError('Acesso negado: o token CSRF foi recusado. Tente novamente.')
      } else {
        setAuthError(error.message)
      }
      return false
    } finally {
      setAuthBusy(false)
    }
  }

  const handleLogout = async () => {
    setLogoutBusy(true)
    setLogoutError('')
    setLogoutRetryAllowed(true)
    try {
      await endSession(csrf)
      setUser(null)
      setCsrf(null)
      setAuthStatus('anonymous')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleSessionExpiration()
      } else if (error instanceof ApiError && error.status === 403) {
        setLogoutError('Acesso negado: o token CSRF foi recusado. A sessão foi mantida.')
        setLogoutRetryAllowed(false)
      } else {
        setLogoutError(error.message)
      }
    } finally {
      setLogoutBusy(false)
    }
  }

  const openVineyardDetails = useCallback((property, trigger) => {
    vineyardTriggerRef.current = trigger
    setSelectedVineyard(property)
  }, [])

  const closeVineyardDetails = useCallback(() => {
    setSelectedVineyard(null)
  }, [])

  useEffect(() => {
    if (selectedVineyard) return
    vineyardTriggerRef.current?.focus()
    vineyardTriggerRef.current = null
  }, [selectedVineyard])

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined
    let active = true
    let inFlight = false
    let controller

    const loadReadings = async () => {
      if (document.visibilityState === 'hidden') return
      if (inFlight) return
      inFlight = true
      controller = new AbortController()
      try {
        const data = await getCurrentReadings({ signal: controller.signal })
        if (active) {
          setReadings(data)
          setReadingsError('')
          setNow(new Date())
        }
      } catch (error) {
        if (active && error.name !== 'AbortError') setReadingsError(error.message)
      } finally {
        inFlight = false
        if (active) setReadingsLoading(false)
      }
    }

    loadReadings()
    const timer = window.setInterval(loadReadings, API_REFRESH_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
      controller?.abort()
    }
  }, [authStatus, readingsRetry])

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined
    let active = true
    let inFlight = false
    let controller

    const loadHistory = async () => {
      if (document.visibilityState === 'hidden') return
      if (inFlight) return
      inFlight = true
      controller = new AbortController()
      setHistoryLoading(true)
      setHistoryError('')
      try {
        const points = await getSensorHistory(metric, 20, { signal: controller.signal })
        if (active) {
          setHistory(points)
          setHistoryAttribute(metric)
          setHistoryError('')
          setHistoryUpdatedAt(new Date())
          setHistoryUpdatedMetric(metric)
        }
      } catch (error) {
        if (active && error.name !== 'AbortError') setHistoryError(error.message)
      } finally {
        inFlight = false
        if (active) setHistoryLoading(false)
      }
    }

    loadHistory()
    const timer = window.setInterval(loadHistory, API_REFRESH_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
      controller?.abort()
    }
  }, [authStatus, metric, historyRetry])

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined
    let active = true
    const controller = new AbortController()
    getEnvironments({ signal: controller.signal }).then((data) => {
      if (!active) return
      setEnvironments(data)
      setEnvironmentsError('')
    }).catch((error) => {
      if (active && error.name !== 'AbortError') setEnvironmentsError(error.message)
    }).finally(() => {
      if (active) setEnvironmentsLoading(false)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [authStatus, environmentsRetry])

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined
    let active = true
    const controller = new AbortController()
    getDevices({ signal: controller.signal }).then((data) => {
      if (!active) return
      setDevices(data)
      setDevicesError('')
    }).catch((error) => {
      if (active && error.name !== 'AbortError') setDevicesError(error.message)
    }).finally(() => {
      if (active) setDevicesLoading(false)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [authStatus, devicesRetry])

  const activeLimitDevice = devices.some((device) => device.id === selectedLimitDevice)
    ? selectedLimitDevice
    : devices[0]?.id ?? null

  useEffect(() => {
    if (authStatus !== 'authenticated' || activeLimitDevice === null) return undefined
    let active = true
    const controller = new AbortController()
    getDeviceLimits(activeLimitDevice, { signal: controller.signal }).then((data) => {
      if (!active) return
      setDeviceLimits(data)
      setLimitsError('')
    }).catch((error) => {
      if (active && error.name !== 'AbortError') setLimitsError(error.message)
    }).finally(() => {
      if (active) setLimitsLoading(false)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [authStatus, activeLimitDevice, limitsRetry])

  const handleCreateEnvironment = async (event) => {
    event.preventDefault()
    setEnvironmentBusy(true)
    setEnvironmentSaveError('')
    setEnvironmentSaveSuccess('')
    try {
      const created = await createEnvironment(environmentForm)
      setEnvironments((current) => [...current, created])
      setEnvironmentForm({ name: '', description: '' })
      setEnvironmentSaveSuccess(`Ambiente “${created.name}” cadastrado.`)
    } catch (error) {
      setEnvironmentSaveError(error.message)
    } finally {
      setEnvironmentBusy(false)
    }
  }

  const handleCreateDevice = async (event) => {
    event.preventDefault()
    setDeviceBusy(true)
    setDeviceSaveError('')
    setDeviceSaveSuccess('')
    try {
      const created = await createDevice({
        ...deviceForm,
        environmentId: Number(deviceForm.environmentId || environments[0]?.id),
      })
      setDevices((current) => [...current, created])
      setLimitsLoading(true)
      setSelectedLimitDevice(created.id)
      setDeviceForm((current) => ({
        ...current,
        name: '',
        fiwareId: '',
        fiwareType: '',
        fiwareService: '',
        fiwareServicePath: '',
      }))
      setDeviceSaveSuccess(`Cadastro “${created.name}” salvo.`)
    } catch (error) {
      setDeviceSaveError(error.message)
    } finally {
      setDeviceBusy(false)
    }
  }

  const handleSaveLimit = async (deviceId, limit) => {
    setLimitBusy(true)
    setLimitSaveError('')
    setLimitSaveSuccess('')
    try {
      const saved = await saveDeviceLimit(deviceId, limit)
      setDeviceLimits((current) => [...current.filter((item) => item.metric !== saved.metric), saved])
      setLimitSaveSuccess(`Limite de ${deviceMetrics[saved.metric].label.toLowerCase()} salvo no backend.`)
    } catch (error) {
      setLimitSaveError(error.message)
    } finally {
      setLimitBusy(false)
    }
  }

  const currentValues = useMemo(() => ({
    temperature: readings?.temperature,
    humidity: readings?.humidity,
    luminosity: readings?.luminosity,
  }), [readings])

  const retryReadings = () => {
    if (!readings) setReadingsLoading(true)
    setReadingsRetry((current) => current + 1)
  }
  const retryHistory = () => setHistoryRetry((current) => current + 1)
  const retryEnvironments = () => {
    setEnvironmentsLoading(true)
    setEnvironmentsError('')
    setEnvironmentsRetry((current) => current + 1)
  }
  const retryDevices = () => {
    setDevicesLoading(true)
    setLimitsLoading(true)
    setDevicesError('')
    setDevicesRetry((current) => current + 1)
    setLimitsRetry((current) => current + 1)
  }
  const retryLimits = () => {
    setLimitsLoading(true)
    setLimitsError('')
    setLimitsRetry((current) => current + 1)
  }
  const hasCurrentHistory = historyAttribute === metric

  if (authStatus === 'checking') {
    return <main className="auth-page"><p className="auth-status" role="status">Verificando sessão…</p></main>
  }
  if (authStatus === 'error') {
    return <main className="auth-page"><section className="auth-card" aria-labelledby="session-error-title"><div className="auth-brand"><span className="brand-mark"><Icon name="grapes" size={22} /></span><span>wineguard<span className="brand-dot">.</span></span></div><h1 id="session-error-title">Não foi possível verificar a sessão</h1><p className="auth-error" role="alert">{authError}</p><button className="auth-submit" onClick={retrySessionCheck}>Tentar novamente</button></section></main>
  }
  if (authStatus !== 'authenticated') {
    return <LoginScreen onLogin={handleLogin} error={authError} busy={authBusy} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" inert={Boolean(selectedVineyard)}>
        <a className="brand" href="#inicio" aria-label="Wineguard — início"><span className="brand-mark"><Icon name="grapes" size={22} /></span><span>wineguard<span className="brand-dot">.</span></span></a>
        <div className="workspace-label">PROPRIEDADE</div>
        <div className="workspace-card"><span className="workspace-avatar"><Icon name="grapes" size={17} /></span><span className="workspace-name">WineSensor002<small>Sensor monitorado</small></span><Icon name="down" size={15} /></div>
        <div className="nav-label">MENU PRINCIPAL</div>
        <nav className="main-nav" aria-label="Menu principal">
          <a className="nav-link active" href="#inicio"><Icon name="grid" /> Visão geral</a>
          <a className="nav-link" href="#mapa-vinicolas"><Icon name="grapes" /> Mapa global</a>
          <a className="nav-link" href="#ambientes"><Icon name="grapes" /> Ambientes</a>
          <a className="nav-link" href="#dispositivos"><Icon name="devices" /> Dispositivos</a>
          <a className="nav-link" href="#limites"><Icon name="settings" /> Limites</a>
          <a className="nav-link" href="#historico"><Icon name="chart" /> Histórico</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><Icon name="grapes" size={18} /></span><strong>Da vinha à adega,<br />cada detalhe importa.</strong><p>Leituras recebidas da API do Wineguard.</p><a href="#historico">Ver histórico <Icon name="arrow" size={14} /></a></div>
          <div className="profile"><div className="profile-avatar">{user.username.slice(0, 1).toUpperCase()}</div><div className="profile-info"><strong>{user.username}</strong><span>Usuário autenticado</span></div></div>
        </div>
      </aside>

      <main className="main-content" id="inicio" inert={Boolean(selectedVineyard)}>
        <header className="topbar"><div className="breadcrumb">Wineguard <Icon name="chevron" size={14} /> <strong>Visão geral</strong></div><div className="top-actions"><span className={`live-status ${readingsError ? 'status-error' : readings ? 'status-connected' : ''}`}><i /> {readingsError ? 'Falha na atualização' : readings ? 'API de leituras' : 'Conectando à API'}</span><span className="authenticated-user">{user.username}</span><button className="logout-button" onClick={handleLogout} disabled={logoutBusy}>{logoutBusy ? 'Saindo…' : 'Sair'}</button></div></header>
        <nav className="mobile-nav" aria-label="Navegação principal">
          <a href="#inicio">Visão geral</a>
          <a href="#mapa-vinicolas">Mapa</a>
          <a href="#ambientes">Ambientes</a>
          <a href="#dispositivos">Dispositivos</a>
          <a href="#limites">Limites</a>
          <a href="#historico">Histórico</a>
        </nav>
        <div className="page-content">
          {sessionWarning && <div className="inline-warning" role="alert">{sessionWarning}</div>}
          {logoutError && <div className="inline-warning" role="alert"><span>{logoutError}</span>{logoutRetryAllowed && <button className="retry-button" onClick={handleLogout} disabled={logoutBusy}>Tentar novamente</button>}</div>}
          <section className="welcome-row"><div><p className="date-label">{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)} <span className="welcome-separator">·</span> WINEGUARD</p><h1>Monitoramento da vinícola <span className="wave"><Icon name="grapes" size={21} /></span></h1><p className="page-subtitle">Leituras do sensor WineSensor002. A data e o horário são os recebidos pela API.</p></div><a className="primary-button" href="#dispositivos"><Icon name="plus" size={18} /> Gerenciar dispositivos</a></section>

          {readingsError && readings && <div className="inline-warning" role="alert"><span>Falha ao atualizar as leituras. Exibindo a última resposta recebida.</span><button className="retry-button" onClick={retryReadings}>Tentar novamente</button></div>}
          <section className="stats-grid" aria-label="Leituras atuais">
            {Object.entries(metrics).map(([key, config]) => (
              <article className="stat-card" key={key}><div className="stat-top"><span>{config.label}</span><span className={`metric-icon ${key === 'luminosity' ? 'light' : key}`}><Icon name={config.icon} /></span></div><div className={`stat-value ${readingsLoading && !readings ? 'value-loading' : ''}`}>{readings ? formatValue(currentValues[key]) : readingsLoading ? '…' : 'Indisponível'}{readings && currentValues[key] !== null && currentValues[key] !== undefined && <span>{config.unit || 'valor LDR'}</span>}</div><div className="stat-footer"><span>{readings ? 'Última leitura do sensor' : readingsError ? 'Falha na consulta' : 'Aguardando resposta'}</span></div></article>
            ))}
            <article className="stat-card"><div className="stat-top"><span>Última medição</span><span className="metric-icon devices"><Icon name="clock" /></span></div><div className="measurement-time">{readings ? formatTimestamp(readings.measuredAt) : 'Indisponível'}</div><div className="stat-footer"><span>Horário informado pela API</span></div></article>
          </section>

          {!readings && <section className="panel readings-state-panel"><RequestMessage loading={readingsLoading} error={readingsError} label="leituras" onRetry={retryReadings} /><p>Sensor consultado: WineSensor002. A conexão depende da configuração do proxy /api.</p></section>}

          <div id="mapa-vinicolas"><VineyardMap onOpenDetails={openVineyardDetails} /></div>

          <section className="content-grid">
            <article className="panel chart-panel" id="historico">
              <div className="panel-heading"><div><h2>Histórico de leituras</h2><p>Últimos 20 registros retornados pelo backend</p></div><button className="icon-button subtle" aria-label="Atualizar histórico" onClick={retryHistory} disabled={historyLoading} title="Consultar novamente"><Icon name="clock" size={17} /></button></div>
              <div className="chart-controls">{Object.entries(metrics).map(([key, value]) => <button key={key} className={`metric-tab ${metric === key ? 'selected' : ''}`} style={metric === key ? { '--metric-color': value.color } : {}} onClick={() => setMetric(key)} aria-pressed={metric === key}><span className="metric-tab-dot" />{value.label}</button>)}</div>
              <div className="chart-summary"><span className="chart-current">{formatValue(currentValues[metric])} <small>{metrics[metric].unit || 'valor LDR'}</small></span>{historyUpdatedAt && historyUpdatedMetric === metric && <span className="chart-change">Consulta ao backend {formatTimestamp(historyUpdatedAt.toISOString())}</span>}</div>
              {historyLoading && !hasCurrentHistory && <RequestMessage loading label="histórico" />}
              {historyError && <RequestMessage error={historyError} onRetry={retryHistory} label="histórico" />}
              {!historyLoading && !historyError && hasCurrentHistory && history.length === 0 && <RequestMessage empty label="registros históricos" />}
              {hasCurrentHistory && history.length > 0 && <HistoryChart points={history} metric={metric} />}
              <div className="chart-foot"><span><i className="chart-legend-dot" style={{ background: metrics[metric].color }} /> {hasCurrentHistory ? `${history.length} registro(s)` : 'Aguardando registros'} · {metrics[metric].label}</span><span><Icon name="clock" size={14} /> receivedAt · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span></div>
            </article>

            <article className="panel alert-panel">
              <div className="panel-heading"><div><h2>Cadastro e configuração</h2><p>Gerencie ambientes, dispositivos e limites</p></div><span className="coming-soon">API Java</span></div>
              <div className="pending-feature"><span className="pending-icon"><Icon name="settings" size={19} /></span><strong>Configurações persistidas</strong><p>Os limites ficam salvos no backend. Sua avaliação e o acionamento do ESP não são automáticos nesta tela.</p></div>
              <a className="management-link" href="#limites">Configurar limites ambientais <Icon name="arrow" size={14} /></a>
            </article>
          </section>

          <section className="panel management-panel" id="ambientes">
            <div className="panel-heading"><div><h2>Ambientes <span className="heading-count">{environments.length}</span></h2><p>Cadastros retornados pelo backend Java</p></div><button className="secondary-button" type="button" onClick={retryEnvironments} disabled={environmentsLoading}>Atualizar</button></div>
            <p className="management-notice">O contrato Java atual não declara autenticação ou perfis. A sessão de login do painel não protege estas rotas; aplique autorização no Java ou em um gateway antes da exposição pública.</p>
            <div className="management-columns">
              <form className="management-form" onSubmit={handleCreateEnvironment}>
                <h3>Novo ambiente</h3>
                <label>Nome<input value={environmentForm.name} maxLength={100} onChange={(event) => setEnvironmentForm((current) => ({ ...current, name: event.target.value }))} required /></label>
                <label>Descrição <span>Opcional</span><textarea value={environmentForm.description} maxLength={500} rows={3} onChange={(event) => setEnvironmentForm((current) => ({ ...current, description: event.target.value }))} /></label>
                {environmentSaveError && <p className="form-error" role="alert">{environmentSaveError}</p>}
                {environmentSaveSuccess && <p className="form-success" role="status">{environmentSaveSuccess}</p>}
                <button className="primary-button" type="submit" disabled={environmentBusy}>{environmentBusy ? 'Salvando…' : 'Cadastrar ambiente'}</button>
              </form>
              <div className="management-list">
                <h3>Ambientes cadastrados</h3>
                {environmentsLoading && <RequestMessage loading label="ambientes" />}
                {!environmentsLoading && environmentsError && <RequestMessage error={environmentsError} label="ambientes" onRetry={() => setEnvironmentsRetry((current) => current + 1)} />}
                {!environmentsLoading && !environmentsError && environments.length === 0 && <RequestMessage empty label="ambientes cadastrados" />}
                {!environmentsLoading && !environmentsError && environments.map((environment) => (
                  <article className="management-item" key={environment.id}>
                    <span className="management-item-icon"><Icon name="grapes" size={17} /></span>
                    <div><strong>{environment.name}</strong><p>{environment.description || 'Sem descrição'}</p></div>
                    <span className="management-id">#{environment.id}</span>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="panel management-panel" id="dispositivos">
            <div className="panel-heading devices-heading"><div><h2>Dispositivos <span className="heading-count">{devices.length}</span></h2><p>Registros de sensores associados a ambientes</p></div><button className="secondary-button" type="button" onClick={retryDevices} disabled={devicesLoading}>Atualizar</button></div>
            <p className="management-notice">Este cadastro grava metadados no backend; não provisiona uma entidade no FIWARE. Remoção ainda não está disponível na API.</p>
            <div className="management-columns">
              <form className="management-form" onSubmit={handleCreateDevice}>
                <h3>Novo dispositivo</h3>
                <label>Nome<input value={deviceForm.name} maxLength={100} onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))} required /></label>
                <label>ID FIWARE<input value={deviceForm.fiwareId} maxLength={255} onChange={(event) => setDeviceForm((current) => ({ ...current, fiwareId: event.target.value }))} required placeholder="Identificador da entidade existente" /></label>
                <label>Tipo FIWARE<input value={deviceForm.fiwareType} maxLength={100} onChange={(event) => setDeviceForm((current) => ({ ...current, fiwareType: event.target.value }))} required /></label>
                <div className="management-fields">
                  <label>FIWARE service<input value={deviceForm.fiwareService} maxLength={100} onChange={(event) => setDeviceForm((current) => ({ ...current, fiwareService: event.target.value }))} required /></label>
                  <label>Service path<input value={deviceForm.fiwareServicePath} maxLength={255} onChange={(event) => setDeviceForm((current) => ({ ...current, fiwareServicePath: event.target.value }))} required placeholder="/" /></label>
                </div>
                <label>Ambiente<select value={deviceForm.environmentId || String(environments[0]?.id ?? '')} onChange={(event) => setDeviceForm((current) => ({ ...current, environmentId: event.target.value }))} required disabled={environments.length === 0}>
                  <option value="" disabled>Selecione um ambiente</option>
                  {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
                </select></label>
                {deviceSaveError && <p className="form-error" role="alert">{deviceSaveError}</p>}
                {deviceSaveSuccess && <p className="form-success" role="status">{deviceSaveSuccess}</p>}
                <button className="primary-button" type="submit" disabled={deviceBusy || environments.length === 0}>{deviceBusy ? 'Salvando…' : 'Salvar cadastro'}</button>
              </form>
              <div className="management-list">
                <h3>Dispositivos cadastrados</h3>
                {devicesLoading && <RequestMessage loading label="dispositivos" />}
                {!devicesLoading && devicesError && <RequestMessage error={devicesError} label="dispositivos" onRetry={() => setDevicesRetry((current) => current + 1)} />}
                {!devicesLoading && !devicesError && devices.length === 0 && <RequestMessage empty label="dispositivos cadastrados" />}
                {!devicesLoading && !devicesError && devices.map((device) => (
                  <article className="management-item device-management-item" key={device.id}>
                    <span className="management-item-icon"><Icon name="devices" size={17} /></span>
                    <div><strong>{device.name}</strong><p>{device.fiwareId} · {device.environmentName} · {device.active ? 'Ativo' : 'Inativo'}</p><small>{device.fiwareType} · {device.fiwareService}{device.fiwareServicePath}</small></div>
                    <span className="management-id">#{device.id}</span>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="panel management-panel" id="limites">
            <div className="panel-heading"><div><h2>Limites ambientais</h2><p>Configuração por dispositivo e métrica</p></div></div>
            <p className="management-notice">Salvar limites apenas persiste a configuração no backend; não aciona o ESP nem avalia alertas automaticamente. Confirme com a equipe técnica as faixas e unidades adequadas aos sensores.</p>
            {devices.length > 0 && <label className="device-limit-select">Dispositivo<select value={activeLimitDevice ?? ''} onChange={(event) => {
              setLimitsLoading(true)
              setLimitsError('')
              setSelectedLimitDevice(Number(event.target.value))
            }}>
              {devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.fiwareId}</option>)}
            </select></label>}
            {limitSaveError && <p className="form-error" role="alert">{limitSaveError}</p>}
            {limitSaveSuccess && <p className="form-success" role="status">{limitSaveSuccess}</p>}
            {limitsLoading && activeLimitDevice !== null && <RequestMessage loading label="limites" />}
            {!limitsLoading && limitsError && <RequestMessage error={limitsError} label="limites" onRetry={retryLimits} />}
            {activeLimitDevice === null && !devicesLoading && !devicesError && <RequestMessage empty label="dispositivos para configurar limites" />}
            {!limitsLoading && !limitsError && activeLimitDevice !== null && <div className="limit-editor-grid">
              {Object.keys(deviceMetrics).map((metricName) => (
                <LimitEditor
                  key={`${activeLimitDevice}-${metricName}`}
                  deviceId={activeLimitDevice}
                  metric={metricName}
                  current={deviceLimits.find((limit) => limit.metric === metricName)}
                  busy={limitBusy}
                  onSave={handleSaveLimit}
                />
              ))}
            </div>}
          </section>

          <section className="panel devices-panel" id="dispositivo-monitorado">
            <div className="panel-heading devices-heading"><div><h2>Leituras do WineSensor002</h2><p>Telemetria consultada no serviço Express</p></div></div>
            <div className="device-grid single-device-grid"><article className="device-card"><div className="device-card-top"><div className="device-avatar"><Icon name="devices" size={19} /></div><span className="device-id">WineSensor002</span></div><div className="device-title-row"><div><h3>Sensor WineSensor002</h3><p>Dispositivo retornado pelo backend</p></div></div><div className="device-readings"><span><Icon name="temperature" size={15} /> {formatValue(currentValues.temperature)} °C</span><span><Icon name="humidity" size={15} /> {formatValue(currentValues.humidity)} %</span><span><Icon name="sun" size={15} /> {formatValue(currentValues.luminosity)}</span></div><div className="device-card-bottom"><span className="battery">Luminosidade: escala LDR não calibrada</span></div></article></div>
          </section>
          <footer className="page-footer"><span><i /> Interface Wineguard</span><span>{readings ? `Data da leitura informada pela API: ${formatTimestamp(readings.measuredAt)}` : 'Aguardando dados do backend'} <b>·</b> Sensor: WineSensor002</span></footer>
        </div>
      </main>
      <VineyardDetails property={selectedVineyard} onClose={closeVineyardDetails} />
    </div>
  )
}

export default App
