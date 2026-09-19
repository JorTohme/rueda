import { useCallback, useEffect, useState, type FormEvent } from 'react'

type OperationsView = 'vehicles' | 'drivers' | 'movements' | 'profitability' | 'documents' | 'settlements'
type VehicleStatus = 'active' | 'inactive' | 'maintenance'
type DriverStatus = 'active' | 'inactive'
type MovementKind = 'income' | 'expense'

type Vehicle = { id: string; brand: string; model: string; licensePlate: string; status: VehicleStatus; applications: string[] }
type FleetApplication = { id: string; slug: string; name: string; enabled: boolean }
type Driver = { id: string; fullName: string; email: string | null; phone: string | null; status: DriverStatus }
type Assignment = { id: string; driverId: string; driverName: string; vehicleLabel: string; assignedTo: string | null }
type Movement = { id: string; vehicleId: string; driverId: string | null; kind: MovementKind; category: string; amount: number; occurredOn: string; notes: string | null; applicationSlug: string | null; tripCount: number | null; recipient: 'owner' | 'driver' | null }
type Document = { id: string | null; subject: 'vehicle' | 'driver'; vehicleId: string | null; driverId: string | null; documentType: string; label: string; documentNumber: string | null; expiresOn: string | null; status: 'vigente' | 'proximo_a_vencer' | 'vencido' | 'faltante' }
type Settlement = { id: string; driverId: string; driverName: string; vehicleLabel: string; periodStart: string; periodEnd: string; status: 'draft' | 'closed' | 'paid' | 'collected'; grossIncome: number; driverExpenses: number; ownerAmount: number; driverAmount: number }

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)
const documentLabels: Record<string, string> = { insurance: 'Seguro', registration: 'Cédula / registro', technical_inspection: 'VTV / inspección técnica', license: 'Licencia de conducir', identity: 'Documento de identidad' }

export function Operations({ tenantId, view }: { tenantId: string; view: OperationsView }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [applications, setApplications] = useState<FleetApplication[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [vehicleForm, setVehicleForm] = useState({ brand: '', model: '', licensePlate: '', status: 'active' as VehicleStatus, applications: [] as string[] })
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null)
  const [driverForm, setDriverForm] = useState({ fullName: '', email: '', phone: '' })
  const [assignmentForm, setAssignmentForm] = useState({ driverId: '', vehicleId: '' })
  const [invitationForm, setInvitationForm] = useState({ driverId: '', email: '' })
  const [inviteToken, setInviteToken] = useState('')
  const [movementForm, setMovementForm] = useState({ vehicleId: '', driverId: '', kind: 'income' as MovementKind, category: 'Producción', amount: '', occurredOn: today(), notes: '', applicationSlug: '', tripCount: '', recipient: '' as '' | 'owner' | 'driver' })
  const [documentForm, setDocumentForm] = useState({ subject: 'vehicle' as 'vehicle' | 'driver', vehicleId: '', driverId: '', documentType: 'insurance', documentNumber: '', expiresOn: today(), notes: '' })
  const [settlementForm, setSettlementForm] = useState({ driverId: '', vehicleId: '', periodStart: today().slice(0, 8) + '01', periodEnd: today(), fixedAmount: '0', revenuePercent: '0' })

  const load = useCallback(async () => {
    setError('')
    try {
      const [vehicleResponse, driverResponse, assignmentResponse, movementResponse, documentResponse, settlementResponse, settingsResponse] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/vehicles`),
        fetch(`/api/tenants/${tenantId}/drivers`),
        fetch(`/api/tenants/${tenantId}/assignments`),
        fetch(`/api/tenants/${tenantId}/financial-movements`),
        fetch(`/api/tenants/${tenantId}/documents`),
        fetch(`/api/tenants/${tenantId}/settlements`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ])
      if (![vehicleResponse, driverResponse, assignmentResponse, movementResponse, documentResponse].every((response) => response.ok)) throw new Error('No pudimos cargar la operación')
      setVehicles(await vehicleResponse.json() as Vehicle[])
      const settingsBody = await settingsResponse.json().catch(() => ({ applications: [] })) as { applications?: FleetApplication[] }
      setApplications(settingsResponse.ok ? settingsBody.applications ?? [] : [])
      setDrivers(await driverResponse.json() as Driver[])
      setAssignments(await assignmentResponse.json() as Assignment[])
      const movementBody = await movementResponse.json() as { movements: Movement[] }
      setMovements(movementBody.movements)
      setDocuments(await documentResponse.json() as Document[])
      setSettlements(settlementResponse.ok ? await settlementResponse.json() as Settlement[] : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos cargar la operación')
    }
  }, [tenantId])

  // The effect synchronizes the view with the tenant-scoped API when the route opens.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function submit(event: FormEvent, url: string, body: unknown) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error ?? 'No pudimos guardar los datos')
      }
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos guardar los datos')
    } finally {
      setBusy(false)
    }
  }

  async function closeSettlement(id: string) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/tenants/${tenantId}/settlements/${id}/close`, { method: 'PATCH' })
      if (!response.ok) throw new Error('No pudimos cerrar la liquidación')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos cerrar la liquidación')
    } finally {
      setBusy(false)
    }
  }

  async function saveVehicle(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const url = editingVehicleId ? `/api/tenants/${tenantId}/vehicles/${editingVehicleId}` : `/api/tenants/${tenantId}/vehicles`
      const response = await fetch(url, { method: editingVehicleId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...vehicleForm, licensePlate: vehicleForm.licensePlate.toUpperCase() }) })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'No pudimos guardar el vehículo')
      setVehicleForm({ brand: '', model: '', licensePlate: '', status: 'active', applications: [] })
      setEditingVehicleId(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos guardar el vehículo')
    } finally {
      setBusy(false)
    }
  }

  function editVehicle(vehicle: Vehicle) {
    setEditingVehicleId(vehicle.id)
    setVehicleForm({ brand: vehicle.brand, model: vehicle.model, licensePlate: vehicle.licensePlate, status: vehicle.status, applications: vehicle.applications })
  }

  async function inviteDriver(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setInviteToken('')
    try {
      const response = await fetch(`/api/tenants/${tenantId}/drivers/${invitationForm.driverId}/invitations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: invitationForm.email }) })
      const payload = await response.json().catch(() => ({})) as { error?: string; inviteToken?: string }
      if (!response.ok) throw new Error(payload.error ?? 'No pudimos crear la invitación')
      setInviteToken(payload.inviteToken ?? '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos crear la invitación')
    } finally {
      setBusy(false)
    }
  }

  const title = view === 'vehicles' ? 'Vehículos' : view === 'drivers' ? 'Conductores' : view === 'movements' ? 'Ingresos y gastos' : view === 'profitability' ? 'Rentabilidad' : view === 'documents' ? 'Documentación' : 'Liquidaciones'
  const subtitle = view === 'vehicles' ? 'Administrá los autos de tu flota' : view === 'drivers' ? 'Asignaciones y estado operativo' : view === 'movements' ? 'Registrá la producción y los costos de cada vehículo' : view === 'profitability' ? 'Resultado real por vehículo y para toda la flota' : view === 'documents' ? 'Vencimientos de vehículos y conductores' : 'Cerrá el período y conservá las reglas aplicadas'

  return <>
    <div className="page-header operations-header"><div><p className="eyebrow">OPERACIÓN</p><h1>{title}</h1><p className="subtitle">{subtitle}</p></div></div>
    {error && <p className="operation-error" role="alert">{error}</p>}
    {view === 'vehicles' && <section className="operations-layout">
      <form className="panel operation-form" onSubmit={(event) => void saveVehicle(event)}>
        <div className="panel-header"><div><h2>{editingVehicleId ? 'Editar vehículo' : 'Alta de vehículo'}</h2><p>Datos básicos y aplicaciones</p></div>{editingVehicleId && <button className="text-button" type="button" onClick={() => { setEditingVehicleId(null); setVehicleForm({ brand: '', model: '', licensePlate: '', status: 'active', applications: [] }) }}>Cancelar</button>}</div>
        <label>Marca<input value={vehicleForm.brand} onChange={(event) => setVehicleForm({ ...vehicleForm, brand: event.target.value })} required /></label>
        <label>Modelo<input value={vehicleForm.model} onChange={(event) => setVehicleForm({ ...vehicleForm, model: event.target.value })} required /></label>
        <label>Patente<input value={vehicleForm.licensePlate} onChange={(event) => setVehicleForm({ ...vehicleForm, licensePlate: event.target.value })} required /></label>
        <label>Estado<select value={vehicleForm.status} onChange={(event) => setVehicleForm({ ...vehicleForm, status: event.target.value as VehicleStatus })}><option value="active">Activo</option><option value="inactive">Inactivo</option><option value="maintenance">Mantenimiento</option></select></label>
        <fieldset className="checkbox-group"><legend>Aplicaciones habilitadas</legend>{applications.filter((application) => application.enabled).map((application) => <label key={application.slug}><input type="checkbox" checked={vehicleForm.applications.includes(application.slug)} onChange={(event) => setVehicleForm({ ...vehicleForm, applications: event.target.checked ? [...vehicleForm.applications, application.slug] : vehicleForm.applications.filter((slug) => slug !== application.slug) })} /> {application.name}</label>)}{!applications.some((application) => application.enabled) && <small>No hay aplicaciones habilitadas. Configuralas primero.</small>}</fieldset>
        <button className="primary-button" disabled={busy} type="submit">{editingVehicleId ? 'Guardar cambios' : 'Agregar vehículo'}</button>
      </form>
      <section className="panel"><div className="panel-header"><div><h2>Flota</h2><p>{vehicles.length} vehículos</p></div></div><div className="entity-list">{vehicles.map((vehicle) => <article className="entity-row" key={vehicle.id}><span className="entity-icon">▣</span><div><strong>{vehicle.brand} {vehicle.model}</strong><small>{vehicle.licensePlate} · {vehicle.applications.map((slug) => applications.find((application) => application.slug === slug)?.name ?? slug).join(', ') || 'Sin aplicaciones'}</small></div><span className={`status-pill ${vehicle.status}`}>{vehicle.status === 'active' ? 'Activo' : vehicle.status === 'maintenance' ? 'Mantenimiento' : 'Inactivo'}</span><button className="text-button" type="button" onClick={() => editVehicle(vehicle)}>Editar</button></article>)}</div></section>
    </section>}
    {view === 'drivers' && <section className="operations-layout">
      <form className="panel operation-form" onSubmit={(event) => void submit(event, `/api/tenants/${tenantId}/drivers`, { fullName: driverForm.fullName, email: driverForm.email || null, phone: driverForm.phone || null })}>
        <div className="panel-header"><div><h2>Alta de conductor</h2><p>Datos de contacto</p></div></div>
        <label>Nombre completo<input value={driverForm.fullName} onChange={(event) => setDriverForm({ ...driverForm, fullName: event.target.value })} required /></label>
        <label>Email<input type="email" value={driverForm.email} onChange={(event) => setDriverForm({ ...driverForm, email: event.target.value })} /></label>
        <label>Teléfono<input value={driverForm.phone} onChange={(event) => setDriverForm({ ...driverForm, phone: event.target.value })} /></label>
        <button className="primary-button" disabled={busy} type="submit">Agregar conductor</button>
        <hr />
        <h3>Asignar vehículo</h3>
        <select value={assignmentForm.driverId} onChange={(event) => setAssignmentForm({ ...assignmentForm, driverId: event.target.value })} required><option value="">Conductor</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}</select>
        <select value={assignmentForm.vehicleId} onChange={(event) => setAssignmentForm({ ...assignmentForm, vehicleId: event.target.value })} required><option value="">Vehículo</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.brand} {vehicle.model} · {vehicle.licensePlate}</option>)}</select>
        <button className="secondary-button" disabled={busy} type="button" onClick={(event) => void submit(event, `/api/tenants/${tenantId}/assignments`, assignmentForm)}>Asignar</button>
        <hr />
        <h3>Invitar a su portal</h3>
        <select value={invitationForm.driverId} onChange={(event) => setInvitationForm({ ...invitationForm, driverId: event.target.value })} required><option value="">Conductor</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}</select>
        <input type="email" placeholder="Email de la cuenta" value={invitationForm.email} onChange={(event) => setInvitationForm({ ...invitationForm, email: event.target.value })} required />
        <button className="secondary-button" disabled={busy} type="button" onClick={(event) => void inviteDriver(event)}>Generar invitación</button>
        {inviteToken && <p className="operation-hint">Token para compartir: <code>{inviteToken}</code></p>}
      </form>
      <section className="panel"><div className="panel-header"><div><h2>Conductores</h2><p>{drivers.length} registrados</p></div></div><div className="entity-list">{drivers.map((driver) => { const assignment = assignments.find((item) => item.driverId === driver.id && !item.assignedTo); return <article className="entity-row" key={driver.id}><span className="entity-icon driver">♙</span><div><strong>{driver.fullName}</strong><small>{assignment?.vehicleLabel ?? 'Sin vehículo asignado'}</small></div><span className={`status-pill ${driver.status}`}>{driver.status === 'active' ? 'Activo' : 'Inactivo'}</span></article> })}</div></section>
    </section>}
    {view === 'movements' && <section className="operations-layout">
      <form className="panel operation-form" onSubmit={(event) => void submit(event, `/api/tenants/${tenantId}/financial-movements`, { ...movementForm, driverId: movementForm.driverId || null, amount: Number(movementForm.amount), applicationSlug: movementForm.kind === 'income' ? movementForm.applicationSlug : null, tripCount: movementForm.kind === 'income' ? Number(movementForm.tripCount) : null, recipient: movementForm.kind === 'income' ? movementForm.recipient : null })}>
        <div className="panel-header"><div><h2>Cargar movimiento</h2><p>Ingreso o gasto</p></div></div>
        <label>Tipo<select value={movementForm.kind} onChange={(event) => setMovementForm({ ...movementForm, kind: event.target.value as MovementKind, applicationSlug: '', tripCount: '', recipient: '' })}><option value="income">Ingreso</option><option value="expense">Gasto</option></select></label>
        <label>Vehículo<select value={movementForm.vehicleId} onChange={(event) => setMovementForm({ ...movementForm, vehicleId: event.target.value, applicationSlug: '' })} required><option value="">Seleccioná un vehículo</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.brand} {vehicle.model} · {vehicle.licensePlate}</option>)}</select></label>
        <label>Conductor<select value={movementForm.driverId} onChange={(event) => setMovementForm({ ...movementForm, driverId: event.target.value })}><option value="">Sin conductor</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}</select></label>
        {movementForm.kind === 'income' && <>
          <label>Aplicación<select value={movementForm.applicationSlug} onChange={(event) => setMovementForm({ ...movementForm, applicationSlug: event.target.value })} required><option value="">Seleccioná una aplicación</option>{applications.filter((application) => application.enabled && (!movementForm.vehicleId || vehicles.find((vehicle) => vehicle.id === movementForm.vehicleId)?.applications.includes(application.slug))).map((application) => <option key={application.slug} value={application.slug}>{application.name}</option>)}</select></label>
          <label>Cantidad de viajes<input type="number" min="0" step="1" value={movementForm.tripCount} onChange={(event) => setMovementForm({ ...movementForm, tripCount: event.target.value })} required /></label>
          <label>¿Quién cobró?<select value={movementForm.recipient} onChange={(event) => setMovementForm({ ...movementForm, recipient: event.target.value as '' | 'owner' | 'driver' })} required><option value="">Seleccioná quién cobró</option><option value="owner">Dueño</option><option value="driver">Conductor</option></select></label>
        </>}
        <label>Categoría<input value={movementForm.category} onChange={(event) => setMovementForm({ ...movementForm, category: event.target.value })} required /></label>
        <label>Importe<input type="number" min="0.01" step="0.01" value={movementForm.amount} onChange={(event) => setMovementForm({ ...movementForm, amount: event.target.value })} required /></label>
        <label>Fecha<input type="date" value={movementForm.occurredOn} onChange={(event) => setMovementForm({ ...movementForm, occurredOn: event.target.value })} required /></label>
        <label>Nota<input value={movementForm.notes} onChange={(event) => setMovementForm({ ...movementForm, notes: event.target.value })} /></label>
        <button className="primary-button" disabled={busy} type="submit">Guardar movimiento</button>
      </form>
      <section className="panel"><div className="panel-header"><div><h2>Movimientos recientes</h2><p>{movements.length} registrados</p></div></div><div className="entity-list">{movements.slice(0, 12).map((movement) => <article className="entity-row" key={movement.id}><span className={`entity-icon ${movement.kind}`}>{movement.kind === 'income' ? '↙' : '↗'}</span><div><strong>{movement.category}</strong><small>{vehicles.find((vehicle) => vehicle.id === movement.vehicleId)?.licensePlate ?? 'Vehículo'} · {movement.occurredOn}{movement.kind === 'income' && ` · ${applications.find((application) => application.slug === movement.applicationSlug)?.name ?? movement.applicationSlug ?? 'Aplicación'} · ${movement.tripCount ?? 0} viajes · cobró ${movement.recipient === 'owner' ? 'el dueño' : 'el conductor'}`}</small></div><strong className={movement.kind === 'income' ? 'positive' : 'negative'}>{movement.kind === 'income' ? '+' : '−'}{money.format(movement.amount)}</strong></article>)}</div></section>
    </section>}
    {view === 'profitability' && <section className="profitability-grid">
      <div className="metrics"><article className="metric-card"><div className="metric-heading"><span>Ingresos</span><span className="metric-icon green">↙</span></div><strong>{money.format(movements.filter((movement) => movement.kind === 'income').reduce((sum, movement) => sum + movement.amount, 0))}</strong><p>Movimientos registrados</p></article><article className="metric-card"><div className="metric-heading"><span>Gastos</span><span className="metric-icon orange">↗</span></div><strong>{money.format(movements.filter((movement) => movement.kind === 'expense').reduce((sum, movement) => sum + movement.amount, 0))}</strong><p>Costos operativos</p></article><article className="metric-card featured"><div className="metric-heading"><span>Resultado</span><span className="metric-icon">◔</span></div><strong>{money.format(movements.reduce((sum, movement) => sum + (movement.kind === 'income' ? movement.amount : -movement.amount), 0))}</strong><p>Ingresos − gastos</p></article></div>
      <section className="panel"><div className="panel-header"><div><h2>Resultado por vehículo</h2><p>Calculado desde movimientos reales</p></div></div><div className="entity-list">{vehicles.map((vehicle) => { const total = movements.filter((movement) => movement.vehicleId === vehicle.id).reduce((sum, movement) => sum + (movement.kind === 'income' ? movement.amount : -movement.amount), 0); return <article className="entity-row" key={vehicle.id}><span className="entity-icon">▣</span><div><strong>{vehicle.brand} {vehicle.model}</strong><small>{vehicle.licensePlate}</small></div><strong className={total >= 0 ? 'positive' : 'negative'}>{money.format(total)}</strong></article> })}</div></section>
    </section>}
    {view === 'documents' && <section className="operations-layout">
      <form className="panel operation-form" onSubmit={(event) => void submit(event, `/api/tenants/${tenantId}/documents`, { vehicleId: documentForm.subject === 'vehicle' ? documentForm.vehicleId : null, driverId: documentForm.subject === 'driver' ? documentForm.driverId : null, documentType: documentForm.documentType, documentNumber: documentForm.documentNumber || null, expiresOn: documentForm.expiresOn, notes: documentForm.notes || null })}>
        <div className="panel-header"><div><h2>Cargar documento</h2><p>Sin archivos adjuntos por ahora</p></div></div>
        <label>Aplica a<select value={documentForm.subject} onChange={(event) => setDocumentForm({ ...documentForm, subject: event.target.value as 'vehicle' | 'driver', documentType: event.target.value === 'vehicle' ? 'insurance' : 'license' })}><option value="vehicle">Vehículo</option><option value="driver">Conductor</option></select></label>
        {documentForm.subject === 'vehicle' ? <label>Vehículo<select value={documentForm.vehicleId} onChange={(event) => setDocumentForm({ ...documentForm, vehicleId: event.target.value })} required><option value="">Seleccioná un vehículo</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.brand} {vehicle.model} · {vehicle.licensePlate}</option>)}</select></label> : <label>Conductor<select value={documentForm.driverId} onChange={(event) => setDocumentForm({ ...documentForm, driverId: event.target.value })} required><option value="">Seleccioná un conductor</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}</select></label>}
        <label>Tipo<select value={documentForm.documentType} onChange={(event) => setDocumentForm({ ...documentForm, documentType: event.target.value })}>{documentForm.subject === 'vehicle' ? <><option value="insurance">Seguro</option><option value="registration">Cédula / registro</option><option value="technical_inspection">VTV / inspección técnica</option></> : <><option value="license">Licencia de conducir</option><option value="identity">Documento de identidad</option></>}</select></label>
        <label>Número<input value={documentForm.documentNumber} onChange={(event) => setDocumentForm({ ...documentForm, documentNumber: event.target.value })} /></label>
        <label>Vencimiento<input type="date" value={documentForm.expiresOn} onChange={(event) => setDocumentForm({ ...documentForm, expiresOn: event.target.value })} required /></label>
        <button className="primary-button" disabled={busy} type="submit">Guardar documento</button>
      </form>
      <section className="panel"><div className="panel-header"><div><h2>Documentos cargados</h2><p>{documents.length} registrados</p></div></div><div className="entity-list">{documents.map((document) => <article className="entity-row" key={document.id}><span className="entity-icon">▤</span><div><strong>{documentLabels[document.documentType] ?? document.label}</strong><small>{document.vehicleId ? vehicles.find((vehicle) => vehicle.id === document.vehicleId)?.licensePlate : drivers.find((driver) => driver.id === document.driverId)?.fullName} · {document.expiresOn ?? 'Sin vencimiento'}</small></div><span className={`status-pill ${document.status === 'proximo_a_vencer' ? 'maintenance' : document.status === 'vigente' ? 'active' : 'inactive'}`}>{document.status === 'proximo_a_vencer' ? 'Próximo a vencer' : document.status === 'vigente' ? 'Vigente' : document.status === 'vencido' ? 'Vencido' : 'Faltante'}</span></article>)}</div></section>
    </section>}
    {view === 'settlements' && <section className="operations-layout">
      <form className="panel operation-form" onSubmit={(event) => void submit(event, `/api/tenants/${tenantId}/settlements`, settlementForm)}>
        <div className="panel-header"><div><h2>Nueva liquidación</h2><p>La regla queda copiada al cerrar</p></div></div>
        <label>Conductor<select value={settlementForm.driverId} onChange={(event) => setSettlementForm({ ...settlementForm, driverId: event.target.value })} required><option value="">Seleccioná un conductor</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}</select></label>
        <label>Vehículo<select value={settlementForm.vehicleId} onChange={(event) => setSettlementForm({ ...settlementForm, vehicleId: event.target.value })} required><option value="">Seleccioná un vehículo</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.brand} {vehicle.model} · {vehicle.licensePlate}</option>)}</select></label>
        <label>Desde<input type="date" value={settlementForm.periodStart} onChange={(event) => setSettlementForm({ ...settlementForm, periodStart: event.target.value })} required /></label>
        <label>Hasta<input type="date" value={settlementForm.periodEnd} onChange={(event) => setSettlementForm({ ...settlementForm, periodEnd: event.target.value })} required /></label>
        <label>Importe fijo para el dueño<input type="number" min="0" step="0.01" value={settlementForm.fixedAmount} onChange={(event) => setSettlementForm({ ...settlementForm, fixedAmount: event.target.value })} /></label>
        <label>Porcentaje para el dueño<input type="number" min="0" max="100" step="0.01" value={settlementForm.revenuePercent} onChange={(event) => setSettlementForm({ ...settlementForm, revenuePercent: event.target.value })} /></label>
        <button className="primary-button" disabled={busy} type="submit">Crear borrador</button>
      </form>
      <section className="panel"><div className="panel-header"><div><h2>Liquidaciones</h2><p>{settlements.length} períodos</p></div></div><div className="entity-list">{settlements.map((settlement) => <article className="entity-row" key={settlement.id}><span className="entity-icon driver">♙</span><div><strong>{settlement.driverName}</strong><small>{settlement.vehicleLabel} · {settlement.periodStart} al {settlement.periodEnd}</small></div><div className="settlement-amount"><strong>{money.format(settlement.driverAmount)}</strong><small>conductor</small></div><span className={`status-pill ${settlement.status === 'closed' ? 'active' : settlement.status === 'draft' ? 'maintenance' : 'inactive'}`}>{settlement.status === 'draft' ? 'Borrador' : settlement.status === 'closed' ? 'Cerrada' : settlement.status}</span>{settlement.status === 'draft' && <button className="settlement-close" disabled={busy} type="button" onClick={() => void closeSettlement(settlement.id)}>Cerrar</button>}</article>)}</div></section>
    </section>}
  </>
}
