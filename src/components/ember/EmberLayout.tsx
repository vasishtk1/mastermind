import { Outlet } from "react-router-dom";
import { PatientDirectoryProvider } from "@/context/PatientDirectoryContext";
import { EmberSidebar } from "./EmberSidebar";

export const EmberLayout = () => {
  return (
    <PatientDirectoryProvider>
      <div className="min-h-screen flex bg-background text-foreground relative">
        <EmberSidebar />
        <main className="flex-1 min-w-0 relative z-[1]">
          <Outlet />
        </main>
      </div>
    </PatientDirectoryProvider>
  );
};
