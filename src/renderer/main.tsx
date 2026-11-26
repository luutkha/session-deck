import './styles/orca-theme.css'
import './styles/primitives.css'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { applyTheme, readThemePref, subscribeTheme } from './theme/themePref'

// D89: every window loads this same bundle (main, viewer and detached Changes), so the saved theme is
// applied before React paints and stays in sync when another window changes the shared preference.
// index.html keeps class="dark" so the default never flashes; only a stored Light removes it here.
applyTheme(document, readThemePref())
subscribeTheme((theme): void => {
  applyTheme(document, theme)
})

// D87: the two detached windows are separate chunks, so the main window does not parse their code at launch.
const ChangesWindow = lazy(() => import('./code/changes/ChangesWindow').then((m) => ({ default: m.ChangesWindow })))
const ViewerWindow = lazy(() => import('./viewer/ViewerWindow').then((m) => ({ default: m.ViewerWindow })))

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
    {isViewerWindow ? (
      <Suspense fallback={null}>
        <ViewerWindow />
      </Suspense>
    ) : isChangesWindow ? (
      <Suspense fallback={null}>
        <ChangesWindow />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
)
