import { SidebarProvider } from "@/components/ui/sidebar";
import { useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Sun, Moon, Menu, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { BranchSwitcher } from "@/components/BranchSwitcher";
import { usePrivacy } from "@/contexts/PrivacyContext";

function HeaderBar() {
  const [darkMode, setDarkMode] = useState(false);
  const { toggleSidebar } = useSidebar();
  const { hidden, toggle: togglePrivacy } = usePrivacy();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <header className="h-14 flex items-center justify-between border-b px-4 md:px-6 bg-card sticky top-0 z-10">
      <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8 rounded-lg">
        <Menu className="h-5 w-5" />
      </Button>
      <div className="flex items-center gap-2">
        <BranchSwitcher />
        {/* Next to the branch switcher, where the eye is already looking. */}
        <Button
          variant="ghost"
          size="icon"
          onClick={togglePrivacy}
          className="h-8 w-8 rounded-lg"
          title={hidden ? "Show amounts" : "Hide amounts"}
          aria-label={hidden ? "Show amounts" : "Hide amounts"}
          aria-pressed={hidden}
        >
          {hidden ? <EyeOff className="h-4 w-4 text-amber-500" /> : <Eye className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setDarkMode(!darkMode)} className="h-8 w-8 rounded-lg">
          {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <HeaderBar />
          <main className="flex-1 p-3 sm:p-4 md:p-8 overflow-auto">
            <div className="max-w-6xl mx-auto animate-fade-in">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
