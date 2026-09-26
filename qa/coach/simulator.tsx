import { createRoot } from 'react-dom/client'
import { SimulationLab } from '@/components/interview/SimulationLab'
import './qa.css'
const original = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = String(input)
  if (url.includes('/api/') || /^https?:/.test(url)) throw new Error(`Simulator must not call a provider: ${url}`)
  return original(input, init)
}
createRoot(document.getElementById('root')!).render(<main className="qa-shell"><p className="qa-banner">Actual simulator component · synthetic observations · no speech or vision provider</p><SimulationLab /></main>)
