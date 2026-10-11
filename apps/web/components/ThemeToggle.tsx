"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
    window.dispatchEvent(new Event("themechange"));
  };
  return (
    <button className="btn w-9 px-0" onClick={toggle} aria-label="Toggle theme" title="Toggle light/dark">
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
