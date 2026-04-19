import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EmberLayout } from "@/components/ember/EmberLayout";
import ResearcherIDE from "./pages/ResearcherIDE.tsx";
import PatientMonitor from "./pages/PatientMonitor.tsx";
import PatientProfiles from "./pages/PatientProfiles.tsx";
import ModelAudit from "./pages/ModelAudit.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<EmberLayout />}>
            <Route path="/" element={<ResearcherIDE />} />
            <Route path="/sentinel" element={<PatientMonitor />} />
            <Route path="/patients" element={<PatientProfiles />} />
            <Route path="/audit" element={<ModelAudit />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
