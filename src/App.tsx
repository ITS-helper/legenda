import './App.css'

function App() {
  return (
    <main className="app-shell">
      <section className="hero-block">
        <p className="eyebrow">Legenda Analytics</p>
        <h1>Supabase foundation is ready for watch telemetry and attendance data.</h1>
        <p className="hero-copy">
          We now have a local Supabase connection scaffold, a draft SQL schema,
          and a data model shaped around `faceID` shifts plus `AA_BLE` minute telemetry.
        </p>
      </section>

      <section className="status-grid">
        <article className="status-card">
          <h2>Data model</h2>
          <p>Shift attendance from `faceID`, minute facts from `AA_BLE`, daily aggregates in SQL views.</p>
        </article>
        <article className="status-card">
          <h2>Supabase access</h2>
          <p>Frontend publishable access is wired locally. Server-side import can use the secret key.</p>
        </article>
        <article className="status-card">
          <h2>Next build step</h2>
          <p>Create tables in Supabase and start the first importer for the XLS daily batch.</p>
        </article>
      </section>
    </main>
  )
}

export default App
