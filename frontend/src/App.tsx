import { Routes, Route } from 'react-router-dom';
import { useAgents } from './hooks/useAgents';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import AgentDetail from './components/AgentDetail';
import Settings from './components/Settings';

function App() {
  const { agents, loading, error, refetch } = useAgents();

  return (
    <div className="min-h-screen flex flex-col">
      <Header agents={agents} />
      <main className="flex-1 pt-16">
        <Routes>
          <Route
            path="/"
            element={
              <Dashboard
                agents={agents}
                loading={loading}
                error={error}
                refetch={refetch}
              />
            }
          />
          <Route path="/agent/:id" element={<AgentDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
