import { useEffect, useState } from 'react'

type PortalData = {
  profile: { fullName: string; email: string | null; phone: string | null; status: string }
  vehicles: Array<{ id: string; label: string; assignedFrom: string }>
  documents: Array<{ id: string; label: string; subject: string; expiresOn: string; status: string }>
  settlements: Array<{
    id: string
    vehicleLabel: string
    periodStart: string
    periodEnd: string
    status: string
    grossIncome: number
    driverExpenses: number
    driverAmount: number
  }>
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

function date(value: string) {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`))
}

export function DriverPortal({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<PortalData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/tenants/${tenantId}/driver-portal`)
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'Tu cuenta todavía no está vinculada a un conductor.' : 'No pudimos cargar tu portal.')
        return await response.json() as PortalData
      })
      .then((body) => { if (!cancelled) setData(body) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'No pudimos cargar tu portal.') })
    return () => { cancelled = true }
  }, [tenantId])

  if (error) return <div className="page-header"><div><p className="eyebrow">MI PORTAL</p><h1>No pudimos abrir tu portal</h1><p className="subtitle">{error}</p></div></div>
  if (!data) return <div className="page-header"><div><p className="eyebrow">MI PORTAL</p><h1>Cargando…</h1></div></div>

  return <>
    <div className="page-header"><div><p className="eyebrow">MI PORTAL</p><h1>Hola, {data.profile.fullName}</h1><p className="subtitle">Consultá tus vehículos, documentación y liquidaciones.</p></div></div>
    <section className="dashboard-grid">
      <article className="panel"><div className="panel-header"><div><h2>Mi cuenta</h2><p>{data.profile.email ?? 'Sin email'}{data.profile.phone ? ` · ${data.profile.phone}` : ''}</p></div><span className="status-pill active">{data.profile.status === 'active' ? 'Activo' : 'Inactivo'}</span></div></article>
      <article className="panel"><div className="panel-header"><div><h2>Vehículos asignados</h2><p>{data.vehicles.length} activos</p></div></div><div className="entity-list">{data.vehicles.length ? data.vehicles.map((vehicle) => <div className="entity-row" key={vehicle.id}><span className="entity-icon">▣</span><div><strong>{vehicle.label}</strong><small>Desde {date(vehicle.assignedFrom)}</small></div></div>) : <p className="subtitle">No tenés vehículos asignados.</p>}</div></article>
    </section>
    <section className="dashboard-grid">
      <article className="panel"><div className="panel-header"><div><h2>Documentación</h2><p>Estado de tus documentos y vehículos asignados</p></div></div><div className="entity-list">{data.documents.length ? data.documents.map((document) => <div className="entity-row" key={document.id}><span className="entity-icon">▤</span><div><strong>{document.label}</strong><small>Vence {date(document.expiresOn)}</small></div><span className={`status-pill ${document.status === 'vigente' ? 'active' : 'maintenance'}`}>{document.status.replaceAll('_', ' ')}</span></div>) : <p className="subtitle">No hay documentación cargada.</p>}</div></article>
      <article className="panel"><div className="panel-header"><div><h2>Liquidaciones</h2><p>Importes informados por la flota</p></div></div><div className="entity-list">{data.settlements.length ? data.settlements.map((settlement) => <div className="entity-row" key={settlement.id}><span className="entity-icon income">↙</span><div><strong>{settlement.vehicleLabel}</strong><small>{date(settlement.periodStart)} al {date(settlement.periodEnd)} · {settlement.status === 'closed' ? 'Cerrada' : 'Pendiente'}</small></div><span className="settlement-amount"><strong>{money.format(settlement.driverAmount)}</strong><small>Tu parte</small></span></div>) : <p className="subtitle">Todavía no hay liquidaciones.</p>}</div></article>
    </section>
  </>
}
