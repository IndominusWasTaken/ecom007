import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { encryptSecret } from "@ecom/core/crypto";
import { generateTotpSecret, otpauthUrl } from "@ecom/core/totp";
import { getSession } from "@/lib/auth";
import { TotpForm } from "../LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Two-factor" };

export default async function TwoFactorPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.stage === "full") redirect("/");
  const enrolling = !s.user.totpEnabled;
  let qr: string | null = null;
  let secret: string | null = null;
  let enrol: string | undefined;
  if (enrolling) {
    secret = generateTotpSecret();
    enrol = encryptSecret(secret);
    qr = await QRCode.toDataURL(otpauthUrl(secret, s.user.username), { margin: 1, width: 200 });
  }
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-1 text-lg font-semibold">{enrolling ? "Set up two-factor" : "Two-factor code"}</h1>
        {enrolling ? (
          <>
            <p className="mb-4 text-sm text-muted">Scan with Google Authenticator, 1Password, Authy or similar, then enter the 6-digit code to finish.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr!} alt="Authenticator QR code" className="mx-auto mb-2 rounded-lg bg-white p-2" width={200} height={200} />
            <p className="mb-4 break-all text-center font-mono text-xs text-muted">{secret}</p>
          </>
        ) : (
          <p className="mb-4 text-sm text-muted">Enter the code from your authenticator app.</p>
        )}
        <TotpForm enrol={enrol} />
        <form action="/logout" method="post" className="mt-3">
          <button className="w-full text-center text-xs text-muted hover:text-ink">Use a different account</button>
        </form>
      </div>
    </div>
  );
}
