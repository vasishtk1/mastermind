import { Outlet } from "react-router-dom";
import { EmberClinicalProvider } from "@/context/EmberClinicalContext";
import { ClinicianSidebar } from "./ClinicianSidebar";
import { TelemetryDrawer } from "./TelemetryDrawer";

export const ClinicianLayout = () => {
  return (
    <EmberClinicalProvider>
      <div className="min-h-screen flex bg-background text-foreground relative">
        <ClinicianSidebar />
        <main className="flex-1 min-w-0 relative z-[1] flex flex-col min-h-0">
          <Outlet />
        </main>
        <TelemetryDrawer />
      </div>
    </EmberClinicalProvider>
  );
};
