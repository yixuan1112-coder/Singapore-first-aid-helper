import { lazy, Suspense } from 'react';
import Join from './Join';
import Profile from './Profile';
import ResponderControls from './ResponderControls';
import CivilianSos from './CivilianSos';
import ResponderSos from './ResponderSos';
import ReportIssue from './ReportIssue';
import OpsConsole from './OpsConsole';
import OpsActions from './OpsActions';
import Alerts from './Alerts';
import AgentHub from './AgentHub';
import { useAppContext } from '../AppContext';

// MapLibre GL is the heaviest dependency — split it into its own chunk that
// loads once you're past the role screen.
const MapCanvas = lazy(() => import('./map/MapCanvas'));

function MapLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-1">
      <span className="text-[10px] uppercase tracking-widest font-bold text-text-secondary animate-pulse">
        Loading map
      </span>
    </div>
  );
}

export default function Shell() {
  const { isAuthenticated } = useAppContext();
  if (!isAuthenticated) return <Join />;

  // Every role lands on the same thing for now: the live map. Features get
  // layered back in one at a time.
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-surface-0">
      <Suspense fallback={<MapLoading />}>
        <MapCanvas />
      </Suspense>
      <ResponderControls />
      <CivilianSos />
      <ResponderSos />
      <ReportIssue />
      <OpsConsole />
      <OpsActions />
      <Alerts />
      <AgentHub />
      <Profile />
    </div>
  );
}
