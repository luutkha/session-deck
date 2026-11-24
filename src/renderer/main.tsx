import './styles/orca-theme.css'
import './styles/primitives.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ChangesWindow } from './code/changes/ChangesWindow'
import { ViewerWindow } from './viewer/ViewerWindow'
import './styles.css'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('Root container not found')
}

// D73: a detached file-viewer window carries its request in the launch argument; it must never mount
// the app shell (which would try to attach terminals and read the session store).
const isViewerWindow = window.api?.viewerRequest != null
// D83: same for a detached Changes window (the two are exclusive: a launch argument carries one request).
const isChangesWindow = window.api?.changesWindowRequest != null

createRoot(container).render(
  <StrictMode>
    {isViewerWindow ? <ViewerWindow /> : isChangesWindow ? <ChangesWindow /> : <App />}
  </StrictMode>
)
