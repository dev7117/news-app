import { useEffect } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Moon, Plus, Settings, Sun } from "lucide-react";
import { MeetingFromUrl } from "./components/MeetingDialog";
import TaskDialog from "./components/TaskDialog";
import { useCounts } from "./lib/api";
import { ToastProvider } from "./hooks/useToast";
import { useTheme } from "./theme";
import InboxPage from "./pages/InboxPage";
import IntakePage from "./pages/IntakePage";
import CustomerHubPage from "./pages/CustomerHubPage";
import CustomersPage from "./pages/CustomersPage";
import ProjectPage from "./pages/ProjectPage";
import ReviewPage from "./pages/ReviewPage";
import SettingsPage from "./pages/SettingsPage";
import TasksPage from "./pages/TasksPage";
import TodayPage from "./pages/TodayPage";

/* The mark: a check, in the accent. */
function Mark() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[15px] w-[15px]">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

function ThemeToggle() {
  const { resolvedDark, setMode } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setMode(resolvedDark ? "light" : "dark")}
      className="btn btn-quiet btn-sm btn-icon"
      title={resolvedDark ? "Switch to light" : "Switch to dark"}
      aria-label={resolvedDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {resolvedDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function Nav({ className }: { className: string }) {
  const { data: counts } = useCounts();
  const items = [
    { to: "/", label: "Today", end: true, count: counts?.today },
    { to: "/inbox", label: "Inbox", count: counts?.inbox },
    { to: "/tasks", label: "All tasks" },
    { to: "/customers", label: "Customers" },
    { to: "/review", label: "Review", count: counts?.review, attention: true },
  ];
  return (
    <nav className={className}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className="nav-link shrink-0 gap-1.5 whitespace-nowrap">
          {item.label}
          {!!item.count &&
            ("attention" in item ? (
              <span className="tabular grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[0.6875rem] font-semibold text-accent-ink">
                {item.count}
              </span>
            ) : (
              <span className="tabular text-xs text-faint">{item.count}</span>
            ))}
        </NavLink>
      ))}
    </nav>
  );
}

/** "n" or "/" focuses the add box from anywhere (jumping to Today if the page has none). */
function useShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "n" || e.key === "/") {
        e.preventDefault();
        const box = document.getElementById("quick-add");
        if (box) box.focus();
        else navigate("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

/** ?task=<id> on any page opens that task, so links from the bar and Claude land on it. */
function TaskFromUrl() {
  const [params, setParams] = useSearchParams();
  const id = Number(params.get("task"));
  if (!id) return null;
  return (
    <TaskDialog
      taskId={id}
      onClose={() => {
        const next = new URLSearchParams(params);
        next.delete("task");
        setParams(next);
      }}
    />
  );
}

function Shell() {
  useShortcuts();
  const location = useLocation();
  if (location.pathname === "/intake") {
    return (
      <div className="frame">
        <IntakePage />
        <TaskFromUrl />
        <MeetingFromUrl />
      </div>
    );
  }
  return (
    <div className="frame">
      <header className="sticky top-0 z-40 border-b border-edge bg-panel/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-4 sm:px-8">
          <NavLink to="/" className="inline-flex shrink-0 items-center gap-2.5 text-[0.9375rem] font-semibold tracking-[-0.015em]">
            <Mark />
            <span className="hidden sm:inline">Todo</span>
          </NavLink>
          <Nav className="hidden items-center gap-0.5 md:flex" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NavLink to="/settings" className="btn btn-quiet btn-sm btn-icon" title="Settings" aria-label="Settings">
              <Settings size={16} />
            </NavLink>
            <button
              type="button"
              className="btn btn-primary btn-sm ml-2"
              title="New task (n)"
              onClick={() => document.getElementById("quick-add")?.focus()}
            >
              <Plus size={15} />
              <span className="hidden sm:inline">New task</span>
            </button>
          </div>
        </div>
        {/* Below md the section links scroll horizontally under the header. */}
        <Nav className="mx-auto flex max-w-[1280px] gap-0.5 overflow-x-auto px-3 pb-2 sm:px-7 md:hidden [scrollbar-width:none]" />
      </header>
      <main className="mx-auto w-full max-w-[1280px] px-4 pb-24 pt-8 sm:px-8 sm:pt-10">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:customerId" element={<CustomerHubPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/projects" element={<Navigate to="/customers" replace />} />
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <TaskFromUrl />
      <MeetingFromUrl />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </BrowserRouter>
  );
}
