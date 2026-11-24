import { Outlet, useLocation } from 'react-router-dom'
import { UnreadProvider } from '../../context/UnreadContext'
import Sidebar from './Sidebar'
import RightRail from './RightRail'
import MobileNav from './MobileNav'

// No AnimatePresence here on purpose: the old wrapper could keep the previous
// page mounted during route changes, which made navigation sometimes look
// stale until a hard refresh. Each page fades itself in via <Page>.
//
// key={location.key} remounts the page on every nav click (even clicking the
// page you are already on), so its data is fetched fresh every time.
export default function AppLayout() {
  const location = useLocation()
  return (
    <UnreadProvider>
      <div className="shell">
        <Sidebar />
        <div className="page-wrap">
          <div className="page" key={location.key}>
            <Outlet />
          </div>
        </div>
        <RightRail />
        <MobileNav />
      </div>
    </UnreadProvider>
  )
}
