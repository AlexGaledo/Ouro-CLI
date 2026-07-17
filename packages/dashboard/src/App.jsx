import { useEffect, useState } from "react";
import { useTickets } from "./store/tickets.js";
import { useAgents } from "./store/agents.js";
import { useUI } from "./store/ui.js";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import Board from "./components/Board.jsx";
import AgentsScreen from "./components/AgentsScreen.jsx";
import Terminal from "./components/Terminal.jsx";
import NewTicketForm from "./components/NewTicketForm.jsx";
import Icon from "./components/Icon.jsx";

export default function App() {
  const hydrate = useTickets((s) => s.hydrate);
  const hydrateConfig = useTickets((s) => s.hydrateConfig);
  const connectSocket = useTickets((s) => s.connectSocket);
  const connected = useTickets((s) => s.connected);

  const hydrateAgents = useAgents((s) => s.hydrate);
  const view = useUI((s) => s.view);

  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    hydrate();
    hydrateConfig();
    hydrateAgents();
    connectSocket();
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

        <div className="workspace">{view === "agents" ? <AgentsScreen /> : <Board />}</div>

        <Terminal />
      </div>

      {showForm && <NewTicketForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
