"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  toast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

const icons: Record<ToastType, ReactNode> = {
  success: <CheckCircle size={16} className="text-accent" />,
  error: <XCircle size={16} className="text-danger" />,
  warning: <AlertTriangle size={16} className="text-warn" />,
  info: <Info size={16} className="text-info" />,
};

const styles: Record<ToastType, string> = {
  success: "border-accent-border bg-accent-surface",
  error: "border-danger-border bg-danger-surface",
  warning: "border-[#3a3520] bg-[#1c1a10]",
  info: "border-[#1a2a3a] bg-[#101a2a]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const tc = useTranslations("Common");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider
      value={{
        toast: addToast,
        success: (m) => addToast("success", m),
        error: (m) => addToast("error", m),
        warning: (m) => addToast("warning", m),
        info: (m) => addToast("info", m),
      }}
    >
      {children}

      {/* Live region: polite for status, assertive for errors */}
      <div
        id="toast-container"
        className="pointer-events-none fixed inset-x-4 top-4 z-[9999] ml-auto flex max-w-[380px] flex-col gap-2 pt-[env(safe-area-inset-top)]"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex items-center gap-3 rounded-[10px] border px-4 py-3 shadow-lg ${styles[t.type]}`}
            style={{ animation: "slide-in 0.3s ease-out" }}
          >
            <span aria-hidden className="flex">{icons[t.type]}</span>
            <span className="flex-1 text-[13.5px] text-text">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label={tc("close")}
              className="-m-2 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-3 transition-colors hover:text-text"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
