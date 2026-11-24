import { useState } from 'react'
import { Terminal } from 'lucide-react'

// Shown when Supabase credentials are missing. Honest setup gate —
// no fake features, just exact instructions to go live.
export default function SetupScreen() {
  const [copied, setCopied] = useState(false)
  const envText = `VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co\nVITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(envText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="setup-screen">
      <div className="setup-panel panel cut">
        <div className="sticker acc-orange">SYSTEM BOOT // CONFIGURATION REQUIRED</div>
        <h1 className="setup-title">SAS IS NOT<br />CONNECTED YET</h1>
        <p className="setup-sub">
          The frontend is fully built, but the backend (Supabase) needs your project
          credentials. Follow the four steps below — it takes about five minutes.
        </p>

        <ol className="setup-steps">
          <li>
            <span className="mono step-num">01</span>
            <div>
              <b>Create a free project</b> at <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a>.
            </div>
          </li>
          <li>
            <span className="mono step-num">02</span>
            <div>
              Open <b>SQL Editor</b> in the Supabase dashboard and run the entire file
              <code> supabase/schema.sql</code> from this project. It creates every table,
              security policy and storage bucket.
            </div>
          </li>
          <li>
            <span className="mono step-num">03</span>
            <div>
              Copy <b>Project Settings → API → Project URL</b> and the <b>anon public key</b> into
              a file named <code>.env</code> in the project root:
              <div className="env-box mono" onClick={copy} role="button" title="Click to copy">
                {copied ? 'COPIED ✓' : envText}
              </div>
            </div>
          </li>
          <li>
            <span className="mono step-num">04</span>
            <div>
              Restart the dev server (<code>npm run dev</code>) and reload this page.
            </div>
          </li>
        </ol>

        <div className="setup-note mono dim">
          SECURITY: only the public anon key goes in .env — all privacy is enforced by
          Row Level Security policies inside supabase/schema.sql.
        </div>

        <button className="btn" onClick={() => window.location.reload()}>
          <Terminal size={15} /> RECHECK CONFIGURATION
        </button>
      </div>
    </div>
  )
}
