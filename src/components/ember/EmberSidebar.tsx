import { NavLink } from "react-router-dom";
import { Brain, HeartPulse, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const items = [
  { to: "/", icon: Brain, label: "Researcher IDE" },
  { to: "/sentinel", icon: HeartPulse, label: "Patient Monitor" },
  { to: "/patients", icon: Users, label: "Patient Profiles" },
];

export const EmberSidebar = () => {
  return (
    <aside
      className="shrink-0 flex flex-col items-center py-5 gap-2 z-10 border-r border-border"
      style={{ width: 60, background: "hsl(var(--surface))" }}
    >
      <div className="w-9 h-9 rounded-md bg-gradient-to-br from-primary to-secondary grid place-items-center mb-4 glow-teal">
        <span className="mono text-[11px] font-bold text-background">EM</span>
      </div>
      <TooltipProvider delayDuration={100}>
        {items.map(({ to, icon: Icon, label }) => (
          <Tooltip key={to}>
            <TooltipTrigger asChild>
              <NavLink
                to={to}
                end
                className={({ isActive }) =>
                  `w-10 h-10 rounded-md grid place-items-center transition-all border ${
                    isActive
                      ? "bg-primary/15 border-primary/50 text-primary glow-teal"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-surface-elevated"
                  }`
                }
              >
                <Icon className="w-5 h-5" />
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right" className="mono text-xs">{label}</TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>
      <div className="mt-auto mono text-[9px] text-muted-foreground/60 tracking-widest [writing-mode:vertical-rl]">
        EMBER · v0.1
      </div>
    </aside>
  );
};
