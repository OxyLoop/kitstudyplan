import { useEffect } from 'react'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DataProvider } from './lib/data'
import Compare from './pages/Compare'
import Explorer from './pages/Explorer'
import Handbook from './pages/Handbook'
import ModuleDetail from './pages/ModuleDetail'
import NotFound from './pages/NotFound'
import Planner from './pages/Planner'
import Requirements from './pages/Requirements'
import SettingsPage from './pages/Settings'
import { StoreProvider } from './state/store'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <DataProvider>
      <StoreProvider>
        <HashRouter>
          <ScrollToTop />
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Explorer />} />
              <Route path="module/:id" element={<ModuleDetail />} />
              <Route path="compare" element={<Compare />} />
              <Route path="planner" element={<Planner />} />
              <Route path="requirements" element={<Requirements />} />
              <Route path="handbook" element={<Handbook />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </HashRouter>
      </StoreProvider>
    </DataProvider>
  )
}
