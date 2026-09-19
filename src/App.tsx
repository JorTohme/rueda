import { useEffect, useState, type FormEvent } from 'react'
import './App.css'
import { Operations } from './Operations'
import { DriverPortal } from './DriverPortal'
import { Settings } from './Settings'

type DashboardSummary = {
  totals: { income: number; expenses: number; profit: number }
  vehicleCount: number
  activeVehicleCount: number
  driverCount: number
  documentsDue: number
  tenantName: string
  period: string
  profitChangePercent: number | null
  profitByVehicle: Array<{ vehicleId: string; label: string; profit: number }>
  monthlyTrend: Array<{ month: string; income: number; expenses: number; profit: number }>
  recentMovements: Array<{ id: string; kind: 'income' | 'expense'; category: string; amount: number; occurredOn: string; vehicleLabel: string }>
  pendingSettlements: Array<{ id: string; driverName: string; vehicleLabel: string; periodStart: string; periodEnd: string; status: string; ownerAmount: number; driverAmount: number }>
}

type AuthUser = { id: string; email: string }
type AuthMembership = { tenantId: string; tenantName: string; role: string }

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})
const compactMoney = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 })
const monthFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short' })
const dateFormatter = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' })

function initials(value: string) {
  return value.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function statusLabel(value: string) {
  return { draft: 'Borrador', closed: 'Cerrada', paid: 'Pagada', collected: 'Cobrada' }[value] ?? value
}

function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [activeRole, setActiveRole] = useState('owner')
  const [authLoading, setAuthLoading] = useState(true)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'invite'>('login')
  const [organizationName, setOrganizationName] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerError, setRegisterError] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [activeTenantId, setActiveTenantId] = useState('demo-fleet')
  const [activeView, setActiveView] = useState(window.location.hash.slice(1) || 'dashboard')
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [dashboardError, setDashboardError] = useState(false)
  const [openMenu, setOpenMenu] = useState<'sidebar-user' | 'top-user' | 'notifications' | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/auth/me', { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return null
        if (!response.ok) throw new Error('Auth request failed')
        return await response.json() as { user: AuthUser; memberships: AuthMembership[] }
      })
      .then((body) => {
        if (!body) return
        setAuthUser(body.user)
        const role = body.memberships[0]?.role ?? 'owner'
        setActiveRole(role)
        const tenantId = body.memberships[0]?.tenantId ?? 'demo-fleet'
        setActiveTenantId(tenantId)
        if (role === 'driver') setActiveView('mi-portal')
        if (role === 'driver') return
        return fetch(`/api/tenants/${tenantId}/dashboard-summary`, { signal: controller.signal })
          .then((response) => {
            if (!response.ok) throw new Error('Dashboard request failed')
            return response.json() as Promise<DashboardSummary>
          })
          .then(setSummary)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setDashboardError(true)
      })
      .finally(() => setAuthLoading(false))

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const onHashChange = () => { setActiveView(window.location.hash.slice(1) || 'dashboard'); setMobileNavOpen(false) }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  async function login(event: FormEvent) {
    event.preventDefault()
    setLoginError('')
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password: loginPassword }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      setLoginError(body.error ?? 'No pudimos iniciar sesión')
      return
    }
    const body = await response.json() as { user: AuthUser; memberships: AuthMembership[] }
    setAuthUser(body.user)
    const role = body.memberships[0]?.role ?? 'owner'
    setActiveRole(role)
    const tenantId = body.memberships[0]?.tenantId ?? 'demo-fleet'
    setActiveTenantId(tenantId)
    if (role === 'driver') { setActiveView('mi-portal'); return }
    const summaryResponse = await fetch(`/api/tenants/${tenantId}/dashboard-summary`)
    if (summaryResponse.ok) setSummary(await summaryResponse.json() as DashboardSummary)
  }

  async function register(event: FormEvent) {
    event.preventDefault()
    setRegisterError('')
    const response = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationName, email: loginEmail, password: registerPassword }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      setRegisterError(body.error ?? 'No pudimos crear la cuenta')
      return
    }
    const body = await response.json() as { user: AuthUser; memberships: AuthMembership[] }
    const tenantId = body.memberships[0]?.tenantId ?? 'demo-fleet'
    setAuthUser(body.user)
    const role = body.memberships[0]?.role ?? 'owner'
    setActiveRole(role)
    setActiveTenantId(tenantId)
    if (role === 'driver') { setActiveView('mi-portal'); return }
    const summaryResponse = await fetch(`/api/tenants/${tenantId}/dashboard-summary`)
    if (summaryResponse.ok) setSummary(await summaryResponse.json() as DashboardSummary)
  }

  async function acceptInvitation(event: FormEvent) {
    event.preventDefault()
    setInviteError('')
    const response = await fetch('/api/driver-invitations/accept', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: inviteToken, password: invitePassword }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      setInviteError(body.error ?? 'No pudimos aceptar la invitación')
      return
    }
    const body = await response.json() as { user: AuthUser; memberships: AuthMembership[] }
    setAuthUser(body.user)
    setActiveRole('driver')
    setActiveTenantId(body.memberships[0]?.tenantId ?? 'demo-fleet')
    setActiveView('mi-portal')
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAuthUser(null)
    setActiveRole('owner')
    setSummary(null)
    setActiveTenantId('demo-fleet')
    setOpenMenu(null)
    setMobileNavOpen(false)
  }

  const chartData = summary?.monthlyTrend.slice(-6).map((item) => ({ label: monthFormatter.format(new Date(`${item.month}-15T12:00:00`)), income: item.income, expenses: item.expenses })) ?? []
  const chartMax = Math.max(...chartData.flatMap((item) => [item.income, item.expenses]), 1)
  const displayName = (authUser?.email.split('@')[0] ?? 'tu cuenta').replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  const currentPeriod = summary ? monthFormatter.format(new Date(`${summary.period}-15T12:00:00`)) : 'este mes'
  const expenseRate = summary && summary.totals.income > 0 ? Math.round((summary.totals.expenses / summary.totals.income) * 100) : 0
  const availability = summary && summary.vehicleCount > 0 ? (summary.activeVehicleCount / summary.vehicleCount) * 360 : 0
  const fleetReady = Boolean(summary && summary.vehicleCount > 0 && summary.activeVehicleCount === summary.vehicleCount)
  const chartTicks = [chartMax, chartMax * 0.75, chartMax * 0.5, chartMax * 0.25, 0]

  if (authLoading) return <div className="auth-screen"><div className="auth-card"><span className="brand-mark">R</span><p>Cargando tu cuenta…</p></div></div>
  if (!authUser) return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={authMode === 'login' ? login : authMode === 'register' ? register : acceptInvitation}>
        <div className="auth-brand"><span className="brand-mark">R</span><strong>rueda</strong></div>
        <p className="eyebrow">GESTIÓN DE FLOTA</p>
        <h1>{authMode === 'login' ? 'Ingresá a tu cuenta' : authMode === 'register' ? 'Creá tu cuenta' : 'Aceptá tu invitación'}</h1>
        <p className="auth-subtitle">Administrá tus vehículos, conductores y resultados.</p>
        {authMode === 'register' && <><label htmlFor="organization">Nombre de la flota</label><input id="organization" type="text" autoComplete="organization" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></>}
        {authMode === 'invite' ? <><label htmlFor="invite-token">Token de invitación</label><input id="invite-token" type="text" value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} required /><label htmlFor="invite-password">Nueva contraseña</label><input id="invite-password" type="password" autoComplete="new-password" value={invitePassword} onChange={(event) => setInvitePassword(event.target.value)} required /></> : <><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required /><label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={authMode === 'login' ? loginPassword : registerPassword} onChange={(event) => authMode === 'login' ? setLoginPassword(event.target.value) : setRegisterPassword(event.target.value)} required /></>}
        {authMode === 'login' && loginError && <p className="auth-error" role="alert">{loginError}</p>}
        {authMode === 'register' && registerError && <p className="auth-error" role="alert">{registerError}</p>}
        {authMode === 'invite' && inviteError && <p className="auth-error" role="alert">{inviteError}</p>}
        <button className="primary-button auth-submit" type="submit">{authMode === 'login' ? 'Ingresar' : authMode === 'register' ? 'Crear cuenta' : 'Activar cuenta'}</button>
        <button className="auth-switch" type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setLoginError(''); setRegisterError(''); setInviteError('') }}>
          {authMode === 'login' ? '¿Todavía no tenés cuenta? Crear una' : 'Ya tengo una cuenta · Ingresar'}
        </button>
        {authMode === 'login' && <button className="auth-switch" type="button" onClick={() => { setAuthMode('invite'); setInviteError('') }}>Tengo un token de invitación</button>}
      </form>
    </main>
  )

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`} aria-label="Navegación principal">
        <a className="brand" href="#dashboard" aria-label="Rueda inicio">
          <span className="brand-mark">R</span>
          <span>rueda</span>
        </a>

        <div className="fleet-switcher">
          <span className="fleet-avatar">JF</span>
          <span>
            <strong>{summary?.tenantName ?? 'Mi flota'}</strong>
            <small>Cuenta operativa</small>
          </span>
          <span aria-hidden="true">⌄</span>
        </div>

        <nav>
          {activeRole !== 'driver' && <>
          <p className="nav-label">OPERACIÓN</p>
          <a className={`nav-link ${activeView === 'dashboard' ? 'active' : ''}`} href="#dashboard"><span>⌂</span> Dashboard</a>
          <a className={`nav-link ${activeView === 'vehiculos' ? 'active' : ''}`} href="#vehiculos"><span>▣</span> Vehículos <b>{summary?.vehicleCount ?? '—'}</b></a>
          <a className={`nav-link ${activeView === 'conductores' ? 'active' : ''}`} href="#conductores"><span>♙</span> Conductores</a>
          <a className={`nav-link ${activeView === 'movimientos' ? 'active' : ''}`} href="#movimientos"><span>⇄</span> Ingresos y gastos</a>
          <a className={`nav-link ${activeView === 'rentabilidad' ? 'active' : ''}`} href="#rentabilidad"><span>◔</span> Rentabilidad</a>
          <a className={`nav-link ${activeView === 'liquidaciones' ? 'active' : ''}`} href="#liquidaciones"><span>≡</span> Liquidaciones</a>

          <p className="nav-label nav-spaced">GESTIÓN</p>
          <a className={`nav-link ${activeView === 'documentos' ? 'active' : ''}`} href="#documentos"><span>▤</span> Documentación <b className="alert-badge">{summary?.documentsDue ?? '—'}</b></a>
          <a className={`nav-link ${activeView === 'configuracion' ? 'active' : ''}`} href="#configuracion"><span>⚙</span> Configuración</a>
          </>}
          {activeRole === 'driver' && <a className={`nav-link ${activeView === 'mi-portal' ? 'active' : ''}`} href="#mi-portal"><span>♙</span> Mi portal</a>}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-icon">?</span>
            <div><strong>¿Necesitás ayuda?</strong><small>Centro de soporte</small></div>
          </div>
          <div className="menu-anchor">
          <button className="user-card" type="button" onClick={() => setOpenMenu(openMenu === 'sidebar-user' ? null : 'sidebar-user')} aria-expanded={openMenu === 'sidebar-user'}>
            <span className="user-avatar">{initials(displayName)}</span>
            <span><strong>{authUser?.email}</strong><small>Administrador</small></span>
            <span aria-hidden="true">⋮</span>
          </button>
          {openMenu === 'sidebar-user' && <div className="popover user-menu"><button type="button" onClick={() => { setOpenMenu(null); setActiveView('configuracion'); window.location.hash = 'configuracion' }}>Configuración</button><button className="danger-action" type="button" onClick={() => void logout()}>Cerrar sesión</button></div>}
          </div>
        </div>
      </aside>

      <main id="dashboard" className="content">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label={mobileNavOpen ? 'Cerrar menú' : 'Abrir menú'} onClick={() => setMobileNavOpen(!mobileNavOpen)}>{mobileNavOpen ? '×' : '☰'}</button>
          <div className="mobile-brand"><span className="brand-mark">R</span> rueda</div>
          <div className="topbar-actions">
            <div className="menu-anchor"><button className="icon-button" type="button" aria-label="Notificaciones" aria-expanded={openMenu === 'notifications'} onClick={() => setOpenMenu(openMenu === 'notifications' ? null : 'notifications')}>♧{summary?.documentsDue ? <i /> : null}</button>{openMenu === 'notifications' && <div className="popover notification-menu"><strong>Notificaciones</strong><p>{summary?.documentsDue ? `${summary.documentsDue} documentos requieren revisión.` : 'No hay notificaciones pendientes.'}</p><button type="button" onClick={() => { setOpenMenu(null); window.location.hash = 'documentos' }}>Ver documentación</button></div>}</div>
            <div className="menu-anchor"><button className="avatar-button" type="button" aria-label="Abrir perfil" aria-expanded={openMenu === 'top-user'} onClick={() => setOpenMenu(openMenu === 'top-user' ? null : 'top-user')}>{initials(displayName)}</button>{openMenu === 'top-user' && <div className="popover top-user-menu"><strong>{authUser?.email}</strong><small>Administrador</small><button type="button" onClick={() => { setOpenMenu(null); window.location.hash = 'configuracion' }}>Configuración</button><button className="danger-action" type="button" onClick={() => void logout()}>Cerrar sesión</button></div>}</div>
          </div>
        </header>

        {activeRole === 'driver' ? <DriverPortal tenantId={activeTenantId} /> : activeView === 'dashboard' ? <>
        <div className="page-header">
          <div>
            <p className="eyebrow">{currentPeriod.toUpperCase()}</p>
            <h1>Buen día, {displayName} <span aria-label="saludo">👋</span></h1>
            <p className="subtitle">Este es el resumen real de tu flota.{dashboardError && " No pudimos actualizar los datos."}</p>
          </div>
          <a className="primary-button" href="#movimientos"><span>＋</span> Cargar movimiento</a>
        </div>

        <section className="metrics" aria-label="Resumen mensual">
          <article className="metric-card featured">
            <div className="metric-heading"><span>Ganancia neta</span><span className="metric-icon">↗</span></div>
          <strong>{summary ? money.format(summary.totals.profit) : "—"}</strong>
            <p>{summary?.profitChangePercent === null ? 'Sin comparación previa' : summary ? <><b>{summary.profitChangePercent > 0 ? '+' : ''}{summary.profitChangePercent}%</b> vs. mes anterior</> : 'Cargando datos'}</p>
          </article>
          <article className="metric-card">
            <div className="metric-heading"><span>Ingresos</span><span className="metric-icon green">↙</span></div>
            <strong>{summary ? money.format(summary.totals.income) : "—"}</strong>
            <p>Producción acumulada</p>
          </article>
          <article className="metric-card">
            <div className="metric-heading"><span>Gastos</span><span className="metric-icon orange">↗</span></div>
            <strong>{summary ? money.format(summary.totals.expenses) : "—"}</strong>
            <p>{summary ? `${expenseRate}% de los ingresos` : 'Cargando datos'}</p>
          </article>
          <article className="metric-card">
            <div className="metric-heading"><span>Vehículos activos</span><span className="metric-icon purple">▣</span></div>
            <strong>{summary?.activeVehicleCount ?? "—"} <em>/ {summary?.vehicleCount ?? "—"}</em></strong>
            <p>{summary ? `${summary.driverCount} conductores activos` : 'Cargando datos'}</p>
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="panel performance-panel">
            <div className="panel-header">
              <div><h2>Rendimiento mensual</h2><p>Ingresos y gastos de tu flota</p></div>
              <button className="select-button" type="button">Últimos 6 meses <span>⌄</span></button>
            </div>
            <div className="legend"><span><i className="income-dot" /> Ingresos</span><span><i className="expense-dot" /> Gastos</span></div>
            <div className="chart" role="img" aria-label="Gráfico de ingresos y gastos de los últimos seis meses">
              <div className="chart-lines">{chartTicks.map((tick) => <span key={tick}>{compactMoney.format(tick)}</span>)}</div>
              <div className="bars">
                {chartData.map((month) => (
                  <div className="bar-group" key={month.label}>
                    <div className="bar income" style={{ height: `${(month.income / chartMax) * 100}%` }} />
                    <div className="bar expense" style={{ height: `${(month.expenses / chartMax) * 100}%` }} />
                    <span>{month.label}</span>
                  </div>
                ))}
                {!chartData.length && <p className="chart-empty">Todavía no hay movimientos para graficar.</p>}
              </div>
            </div>
          </article>

          <article className="panel health-panel">
            <div className="panel-header"><div><h2>Estado de la flota</h2><p>Documentación y vehículos</p></div><button className="more-button" type="button" aria-label="Más opciones">•••</button></div>
            <div className="health-summary"><div className="donut" style={{ background: `conic-gradient(#51b477 0deg ${availability}deg, #e9edf1 ${availability}deg 360deg)` }}><span>{summary?.activeVehicleCount ?? 0}<small>/{summary?.vehicleCount ?? 0}</small></span></div><div><strong>{fleetReady ? 'Todo en marcha' : summary?.vehicleCount ? 'Revisar disponibilidad' : 'Sin vehículos cargados'}</strong><p>Vehículos disponibles</p></div></div>
            <div className="health-row"><span className="status-dot success" /> <div><strong>{summary ? `${summary.activeVehicleCount} vehículos activos` : "Cargando vehículos..."}</strong><small>{summary?.vehicleCount ? `${Math.round((summary.activeVehicleCount / summary.vehicleCount) * 100)}% de disponibilidad` : 'Sin vehículos cargados'}</small></div><span>›</span></div>
            <div className="health-row warning"><span className="status-dot warning-dot" /> <div><strong>{summary ? `${summary.documentsDue} documentos por revisar` : "Cargando alertas..."}</strong><small>Vencidos o próximos a vencer</small></div><span>›</span></div>
          </article>
        </section>

        <section className="dashboard-grid lower-grid">
          <article className="panel settlements-panel">
            <div className="panel-header"><div><h2>Liquidaciones pendientes</h2><p>{summary?.pendingSettlements.length ?? 0} períodos para revisar</p></div><a href="#liquidaciones">Ver todas <span>→</span></a></div>
            <div className="table-wrap"><table><thead><tr><th>CONDUCTOR</th><th>VEHÍCULO</th><th>MONTO DUEÑO</th><th>ESTADO</th></tr></thead><tbody>{summary?.pendingSettlements.map((settlement) => <tr key={settlement.id}><td><span className="table-avatar">{initials(settlement.driverName)}</span>{settlement.driverName}</td><td>{settlement.vehicleLabel}</td><td><strong>{money.format(settlement.ownerAmount)}</strong></td><td><span className={`pill ${settlement.status === 'closed' ? 'collect' : 'pay'}`}>{statusLabel(settlement.status)}</span></td></tr>)}{!summary?.pendingSettlements.length && <tr><td colSpan={4}>No hay liquidaciones pendientes.</td></tr>}</tbody></table></div>
          </article>

          <article className="panel activity-panel">
            <div className="panel-header"><div><h2>Actividad reciente</h2><p>Últimos movimientos</p></div><a href="#movimientos">Ver todo <span>→</span></a></div>
            <ul className="activity-list">
              {summary?.recentMovements.map((movement) => <li key={movement.id}><span className={`activity-icon ${movement.kind === 'income' ? 'income-icon' : 'fuel-icon'}`}>{movement.kind === 'income' ? '↙' : '⛽'}</span><div><strong>{movement.category}</strong><small>{movement.vehicleLabel} · {dateFormatter.format(new Date(`${movement.occurredOn}T12:00:00`))}</small></div><b className={movement.kind === 'income' ? 'positive' : ''}>{movement.kind === 'income' ? '+' : '−'}{money.format(movement.amount)}</b></li>)}
              {!summary?.recentMovements.length && <li className="empty-state"><div><strong>No hay movimientos recientes.</strong><small>Cargá el primero desde Ingresos y gastos.</small></div></li>}
            </ul>
          </article>
        </section>

        <section className="panel vehicle-profit-panel">
          <div className="panel-header"><div><h2>Resultado por vehículo</h2><p>Ingresos menos gastos del mes actual</p></div><a href="#rentabilidad">Ver detalle <span>→</span></a></div>
          <div className="entity-list">{summary?.profitByVehicle.map((vehicle) => <div className="entity-row" key={vehicle.vehicleId}><span className="entity-icon">▣</span><div><strong>{vehicle.label}</strong><small>Resultado neto del período</small></div><strong className={vehicle.profit >= 0 ? 'positive' : 'negative'}>{money.format(vehicle.profit)}</strong></div>)}{!summary?.profitByVehicle.length && <p className="subtitle">No hay vehículos cargados.</p>}</div>
        </section>
        </> : activeView === 'mi-portal' ? <DriverPortal tenantId={activeTenantId} /> : activeView === 'configuracion' ? <Settings tenantId={activeTenantId} /> : activeView === 'vehiculos' || activeView === 'conductores' || activeView === 'movimientos' || activeView === 'rentabilidad' || activeView === 'documentos' || activeView === 'liquidaciones'
          ? <Operations tenantId={activeTenantId} view={activeView === 'vehiculos' ? 'vehicles' : activeView === 'conductores' ? 'drivers' : activeView === 'movimientos' ? 'movements' : activeView === 'rentabilidad' ? 'profitability' : activeView === 'documentos' ? 'documents' : 'settlements'} />
          : <div className="page-header"><div><p className="eyebrow">PRÓXIMAMENTE</p><h1>{activeView === 'rentabilidad' ? 'Rentabilidad' : activeView === 'documentos' ? 'Documentación' : 'Configuración'}</h1><p className="subtitle">Este módulo se completa en el próximo corte operativo.</p></div></div>}
      </main>
    </div>
  )
}

export default App


