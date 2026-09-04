import { Navigate, Route, Routes } from 'react-router-dom';
import { Chrome } from './components/Chrome.jsx';
import Home from './pages/Home.jsx';
import PollPage from './pages/PollPage.jsx';
import History from './pages/History.jsx';
import Admin from './pages/Admin.jsx';

export default function App() {
  return (
    <Chrome>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/poll/:id" element={<PollPage />} />
        <Route path="/history" element={<History />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Chrome>
  );
}
