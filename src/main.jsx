import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import AppLayout from './layout/AppLayout';
import ApiPage from './pages/ApiPage';
import Availability from './pages/Availability';
import Carriers from './pages/Carriers';
import Cleaning from './pages/Cleaning';
import Collection from './pages/Collection';
import Heatmap from './pages/Heatmap';
import IndexDetail from './pages/IndexDetail';
import Landing from './pages/Landing';
import Methodology from './pages/Methodology';
import Overview from './pages/Overview';
import RouteDetail from './pages/RouteDetail';
import Routes from './pages/Routes';
import Split from './pages/Split';
import Tariffs from './pages/Tariffs';
import Validation from './pages/Validation';
import Weights from './pages/Weights';
import Windows from './pages/Windows';

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  {
    element: <AppLayout />,
    children: [
      { path: 'overview', element: <Overview /> },
      { path: 'index', element: <IndexDetail /> },
      { path: 'routes', element: <Routes /> },
      { path: 'routes/:pair', element: <RouteDetail /> },
      { path: 'carriers', element: <Carriers /> },
      { path: 'carriers/:code', element: <Carriers /> },
      { path: 'windows', element: <Windows /> },
      { path: 'heatmap', element: <Heatmap /> },
      { path: 'cleaning', element: <Cleaning /> },
      { path: 'availability', element: <Availability /> },
      { path: 'weights', element: <Weights /> },
      { path: 'validation', element: <Validation /> },
      { path: 'split', element: <Split /> },
      { path: 'tariffs', element: <Tariffs /> },
      { path: 'data', element: <Collection /> },
      { path: 'methodology', element: <Methodology /> },
      { path: 'api-docs', element: <ApiPage /> },
    ],
  },
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
