import { useEffect, useState } from "react";
import { useTickets } from "./store/tickets.js";
import { useAgents } from "./store/agents.js";
import { useUI } from "./store/ui.js";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import Board from "./components/Board.jsx";
import AgentsScreen from "./components/AgentsScreen.jsx";
import ArtifactsScreen from "./components/ArtifactsScreen.jsx";
import LogsScreen from "./components/LogsScreen.jsx";
import SettingsScreen from "./components/SettingsScreen.jsx";
import Terminal from "./components/Terminal.jsx";
import NewTicketForm from "./components/NewTicketForm.jsx";
import Icon from "./components/Icon.jsx";

// A stored view from an older build (or a renamed screen) falls back to the
// board rather than rendering nothing — see the localStorage load in store/ui.js.
const SCREENS = {
  board: Board,
  agents: AgentsScreen,
  artifacts: ArtifactsScreen,
  logs: LogsScreen,
  settings: SettingsScreen,
};

export default function App() {
  const hydrate = useTickets((s) => s.hydrate);
  const hydrateConfig = useTickets((s) => s.hydrateConfig);
  const connectSocket = useTickets((s) => s.connectSocket);
  const connected = useTickets((s) => s.connected);

  const hydrateAgents = useAgents((s) => s.hydrate);
  const view = useUI((s) => s.view);

  const [showForm, setShowForm] = useState(false);
  const Screen = SCREENS[view] ?? Board;

  // Mount-once bootstrap: hydrate state + open the socket a single time. The
  // deps are Zustand selectors returning stable store-action refs that never
  // change, so an empty array is correct — re-running would re-hydrate and
  // reconnect on every render. Deliberately omitted, not overlooked.
  useEffect(() => {
    hydrate();
    hydrateConfig();
    hydrateAgents();
    connectSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <Sidebar />

      <div className="main">
        <Topbar onNewTicket={() => setShowForm(true)} />

        {!connected && (
          <div className="banner warn" role="status">
            <Icon name="alert" size={13} />
            Disconnected from the ouro server — retrying. Is <code>ouro dashboard</code> still running?
          </div>
        )}

        <div className="workspace"><Screen /></div>

        <Terminal />
      </div>

      {showForm && <NewTicketForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
