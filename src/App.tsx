import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClinicianLayout } from "@/components/clinician/ClinicianLayout";

import TriageDashboard from "./pages/TriageDashboard.tsx";
import PatientMonitor from "./pages/PatientMonitor.tsx";
import PatientProfiles from "./pages/PatientProfiles.tsx";
import PatientDashboard from "./pages/PatientDashboard.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<ClinicianLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<TriageDashboard />} />
            <Route path="/patients" element={<PatientProfiles />} />
            <Route path="/patients/:patientId/profile" element={<PatientDashboard />} />
            <Route path="/patients/:patientId/dashboard" element={<PatientDashboard />} />
            <Route path="/benchmarking" element={<PatientMonitor />} />
            <Route path="/sentinel" element={<Navigate to="/benchmarking" replace />} />
            <Route path="/auditing" element={<Navigate to="/dashboard" replace />} />
            <Route path="/audit" element={<Navigate to="/auditing" replace />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
