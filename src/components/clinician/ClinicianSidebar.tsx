import { Link, NavLink, useLocation } from "react-router-dom";
import { Brain, HeartPulse, LayoutGrid, ShieldCheck, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEmberData } from "@/context/EmberClinicalContext";
import { cn } from "@/lib/utils";

const activeRing =
  "border-primary text-primary bg-gradient-to-br from-primary/20 to-amber-500/10 shadow-[0_0_14px_rgba(226,117,51,0.28)]";

export const ClinicianSidebar = () => {
  const { patients, lastViewedPatientId } = useEmberData();
  const location = useLocation();
  const brainTarget = lastViewedPatientId ?? patients[0]?.id ?? "";
  const profilePath = brainTarget ? `/patients/${brainTarget}/profile` : "/patients";
  const profileActive = /^\/patients\/[^/]+\/profile/.test(location.pathname);

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
        src="/ember-v2-logo.png"
        alt="Ember"
        className="w-10 h-10 rounded-md mb-4 border border-border object-cover"
        style={{ boxShadow: "0 0 12px rgba(226,117,51,0.25)" }}
      />
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink to="/dashboard" className={({ isActive }) => navBtn(isActive)} aria-label="Triage dashboard">
              <LayoutGrid className="w-5 h-5" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-sans text-xs">
            Triage · Escalation queue
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
            <NavLink
              to={profilePath}
              className={() => navBtn(profileActive)}
              aria-label="Neuroscience and RAG review"
            >
              <Brain className="w-5 h-5" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-sans text-xs">
            Neuroscience &amp; RAG review
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink to="/sentinel" className={({ isActive }) => navBtn(isActive)} aria-label="Live patient monitor">
              <HeartPulse className="w-5 h-5" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-sans text-xs">
            Live monitor
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink to="/auditing" className={({ isActive }) => navBtn(isActive)} aria-label="Model rigor">
              <ShieldCheck className="w-5 h-5" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-sans text-xs">
            Model rigor &amp; auditing
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Link
        to="/research"
        className="mt-3 mono text-[9px] text-primary/70 hover:text-primary text-center leading-tight px-1 max-w-[52px]"
        title="Researcher IDE"
      >
        Research IDE
      </Link>

      <div className="mt-auto mono text-[9px] text-muted-foreground/60 tracking-widest [writing-mode:vertical-rl]">
        EMBER
      </div>
    </aside>
  );
};
