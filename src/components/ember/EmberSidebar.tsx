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
      <img
        src="/ember-v2-logo.png"
        alt="Ember v2 logo"
        className="w-10 h-10 rounded-md mb-4 border border-border object-cover"
        style={{ boxShadow: "0 0 12px rgba(226,117,51,0.25)" }}
      />
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
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-surface-elevated"
                  }`
                }
                style={({ isActive }) =>
                  isActive
                    ? {
                        background: "linear-gradient(135deg, rgba(226,117,51,0.18) 0%, rgba(214,151,90,0.2) 100%)",
                        boxShadow: "0 0 14px rgba(226,117,51,0.28)",
                      }
                    : undefined
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
