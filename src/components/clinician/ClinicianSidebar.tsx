import { NavLink, useLocation } from "react-router-dom";
import { HeartPulse, LayoutGrid, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const activeRing =
  "border-primary text-primary bg-gradient-to-br from-primary/15 to-primary-glow/10 shadow-[0_0_14px_hsl(var(--primary)/0.28)]";

export const ClinicianSidebar = () => {
  const location = useLocation();
  const labActive = location.pathname.startsWith("/research");

  const navBtn = (isActive: boolean) =>
    cn(
      "w-10 h-10 rounded-md grid place-items-center transition-all border",
      isActive ? activeRing : "border-transparent text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
    );

  return (
    <aside
      className="shrink-0 flex flex-col items-center py-5 gap-2 z-10 border-r border-border bg-surface"
      style={{ width: 60 }}
    >
      <img
        src="/mastermind-mark.svg"
        alt="MasterMind"
        className="w-10 h-10 rounded-md mb-4 border border-border object-contain bg-surface-elevated p-1"
        style={{ boxShadow: "0 0 12px hsl(var(--primary) / 0.25)" }}
      />
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink to="/dashboard" className={({ isActive }) => navBtn(isActive)} aria-label="Incidents dashboard">
              <LayoutGrid className="w-5 h-5" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-sans text-xs">
            Incidents
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink to="/patients" end className={({ isActive }) => navBtn(isActive)} aria-label="Patient roster">
              <Users className="w-5 h-5" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-sans text-xs">
            Patient roster
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink to="/benchmarking" className={({ isActive }) => navBtn(isActive)} aria-label="Benchmarking">
              <HeartPulse className="w-5 h-5" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-sans text-xs">
            Live Benchmarking
          </TooltipContent>
        </Tooltip>

      </TooltipProvider>

      <div className="mt-auto mono text-[9px] text-muted-foreground/70 tracking-widest [writing-mode:vertical-rl]">
        MASTERMIND
      </div>
    </aside>
  );
};
