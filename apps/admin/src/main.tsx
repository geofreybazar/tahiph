import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { TENANT_ROLES } from '@tahi/shared';
import './index.css';

function Home() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">TahiPh</h1>
      <p className="mt-2 text-gray-600">Dashboard shell. Roles: {TENANT_ROLES.join(', ')}.</p>
    </main>
  );
}

const router = createBrowserRouter([{ path: '/', element: <Home /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
