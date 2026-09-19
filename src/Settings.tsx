import { useEffect, useState, type FormEvent } from 'react'

type FleetApplication = { id: string; slug: string; name: string; enabled: boolean }

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function Settings({ tenantId }: { tenantId: string }) {
  const [tenantName, setTenantName] = useState('')
  const [applications, setApplications] = useState<FleetApplication[]>([])
  const [newApplication, setNewApplication] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/tenants/${tenantId}/settings`).then(async (response) => {
      if (!response.ok) throw new Error('No pudimos cargar la configuración')
      return await response.json() as { tenantName: string; applications: FleetApplication[] }
    }).then((body) => {
      if (!cancelled) { setTenantName(body.tenantName); setApplications(body.applications) }
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'No pudimos cargar la configuración') }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [tenantId])

  function addApplication() {
    const name = newApplication.trim()
    const slug = slugify(name)
    if (!name || !slug || applications.some((application) => application.slug === slug)) return
    setApplications([...applications, { id: `new-${slug}`, slug, name, enabled: true }])
    setNewApplication('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setSaved(false)
    setError('')
    try {
      const response = await fetch(`/api/tenants/${tenantId}/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantName, applications: applications.map(({ slug, name, enabled }) => ({ slug, name, enabled })) }) })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'No pudimos guardar la configuración')
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos guardar la configuración')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="page-header operations-header"><div><p className="eyebrow">GESTIÓN</p><h1>Configuración</h1><p className="subtitle">Definí cómo trabaja tu flota.</p></div></div>
    {error && <p className="operation-error" role="alert">{error}</p>}
    <form className="settings-layout" onSubmit={(event) => void save(event)}>
      <section className="panel operation-form">
        <div className="panel-header"><div><h2>Datos de la flota</h2><p>Visible para tu equipo operativo.</p></div></div>
        <label>Nombre de la flota<input value={tenantName} onChange={(event) => setTenantName(event.target.value)} required maxLength={120} /></label>
      </section>
      <section className="panel operation-form">
        <div className="panel-header"><div><h2>Aplicaciones</h2><p>Elegí dónde trabaja cada vehículo.</p></div></div>
        <div className="settings-app-list">{applications.map((application) => <label className="settings-app-row" key={application.slug}><input type="checkbox" checked={application.enabled} onChange={(event) => setApplications(applications.map((item) => item.slug === application.slug ? { ...item, enabled: event.target.checked } : item))} /><span>{application.name}</span><small>{application.slug}</small></label>)}</div>
        <div className="inline-form"><input placeholder="Otra aplicación" value={newApplication} onChange={(event) => setNewApplication(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addApplication() } }} /><button className="secondary-button" type="button" onClick={addApplication}>Agregar</button></div>
        <button className="primary-button" disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar configuración'}</button>
        {saved && <p className="operation-success" role="status">Configuración guardada.</p>}
      </section>
    </form>
  </>
}
