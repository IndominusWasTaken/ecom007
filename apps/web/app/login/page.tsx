import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const s = await getSession();
  if (s?.stage === "full") redirect("/");
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-ink">
            <BarChart3 size={18} />
          </span>
          <h1 className="text-lg font-semibold">Profit Dashboard</h1>
        </div>
        <LoginForm />
        <p className="mt-5 text-xs text-muted">Private site. Accounts are created on the server.</p>
      </div>
    </div>
  );
}
