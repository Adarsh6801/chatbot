"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

type DialogTone = "primary" | "danger" | "neutral";
type DialogOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
  input?: { label?: string; placeholder?: string; defaultValue?: string; type?: "text" | "email" };
};
type DialogRequest = DialogOptions & { kind: "alert" | "confirm" | "prompt" };
type DialogApi = {
  alert: (options: DialogOptions) => Promise<void>;
  confirm: (options: DialogOptions) => Promise<boolean>;
  prompt: (options: DialogOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const resolver = useRef<((value: boolean | string | null) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestDialog = useCallback((next: DialogRequest) => new Promise<boolean | string | null>((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setRequest(next);
  }), []);
  const alert = useCallback(async (options: DialogOptions) => { await requestDialog({ ...options, kind: "alert" }); }, [requestDialog]);
  const confirm = useCallback(async (options: DialogOptions) => (await requestDialog({ ...options, kind: "confirm" })) === true, [requestDialog]);
  const prompt = useCallback(async (options: DialogOptions) => {
    const value = await requestDialog({ ...options, kind: "prompt" });
    return typeof value === "string" ? value : null;
  }, [requestDialog]);
  const finish = useCallback((value: boolean | string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }, []);

  useEffect(() => {
    if (!request) return;
    if (request.kind === "prompt") inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(request.kind === "alert" ? true : request.kind === "prompt" ? null : false);
      if (event.key === "Enter" && request.kind === "confirm") finish(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [request, finish]);

  const value = { alert, confirm, prompt };
  return <DialogContext.Provider value={value}>
    {children}
    {request && <div className="app-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) finish(request.kind === "alert" ? true : request.kind === "prompt" ? null : false); }}>
      <section className="app-dialog" role={request.kind === "alert" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby={request.description ? "app-dialog-description" : undefined}>
        <button className="app-dialog-close" aria-label="Close dialog" onClick={() => finish(request.kind === "alert" ? true : request.kind === "prompt" ? null : false)}><X size={17}/></button>
        <div className={`app-dialog-icon ${request.tone || "primary"}`}>{request.tone === "danger" ? <AlertTriangle size={20}/> : request.kind === "alert" ? <Info size={20}/> : <CheckCircle2 size={20}/>}</div>
        <h2 id="app-dialog-title">{request.title}</h2>
        {request.description && <p id="app-dialog-description">{request.description}</p>}
        {request.kind === "prompt" && request.input && <label className="app-dialog-input">{request.input.label}<input ref={inputRef} type={request.input.type || "text"} placeholder={request.input.placeholder} defaultValue={request.input.defaultValue} onKeyDown={(event) => { if (event.key === "Enter") finish(event.currentTarget.value); }}/></label>}
        <div className="app-dialog-actions">
          {request.kind !== "alert" && <button className="app-dialog-cancel" onClick={() => finish(request.kind === "prompt" ? null : false)}>{request.cancelText || "Cancel"}</button>}
          <button className={`app-dialog-confirm ${request.tone || "primary"}`} onClick={() => finish(request.kind === "prompt" ? inputRef.current?.value ?? "" : true)}>{request.confirmText || (request.kind === "alert" ? "Got it" : request.kind === "prompt" ? "Continue" : "Confirm")}</button>
        </div>
      </section>
    </div>}
  </DialogContext.Provider>;
}

export function useDialogs() {
  const value = useContext(DialogContext);
  if (!value) throw new Error("useDialogs must be used within DialogProvider");
  return value;
}
