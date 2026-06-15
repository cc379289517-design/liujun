"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ROLE_REDIRECT: Record<string, string> = {
  photographer: "/photographer",
  assistant: "/photographer",
  assistant_leader: "/photographer",
  admin: "/photographer",
};

export default function LoginPage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("123456");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const rememberedEmployeeId = localStorage.getItem("spad_login_employee_id");
    if (rememberedEmployeeId) {
      setEmployeeId(rememberedEmployeeId);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "登录失败");
        return;
      }

      localStorage.setItem("user", JSON.stringify(data));
      if (rememberMe) {
        localStorage.setItem("spad_login_employee_id", employeeId);
      } else {
        localStorage.removeItem("spad_login_employee_id");
      }
      router.push(ROLE_REDIRECT[data.role] || "/photographer");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#9caf68] px-5 py-10 text-white"
      style={{
        backgroundImage:
          "linear-gradient(180deg, rgba(14, 29, 45, 0.44) 0%, rgba(159, 174, 116, 0.08) 42%, rgba(34, 74, 20, 0.55) 100%), url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=2400&q=82')",
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(255,255,235,0.34),transparent_30%),linear-gradient(90deg,rgba(255,255,255,0.18),transparent_24%,transparent_76%,rgba(4,20,12,0.2))]" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#12300e]/55 via-[#789229]/18 to-transparent" />
      <div className="absolute -bottom-24 left-1/2 h-64 w-[110vw] -translate-x-1/2 rounded-[50%] bg-[#c9d86e]/20 blur-3xl" />

      <section className="relative z-10 min-w-0" style={{ width: "min(100%, 520px)" }}>
        <form
          onSubmit={handleSubmit}
          className="w-full rounded-[34px] border border-white/55 bg-white/18 px-6 py-8 shadow-[0_28px_80px_rgba(10,32,12,0.34),inset_0_1px_0_rgba(255,255,255,0.62)] backdrop-blur-[22px] sm:px-12 sm:py-11"
        >
          <div className="mb-8">
            <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/55 bg-[#e9f5b7]/78 text-xl font-black text-[#25440d] shadow-[0_10px_30px_rgba(36,66,14,0.22)]">
              S
            </div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-normal text-[#eef6cb]/90">
              SPAD
            </p>
            <h1 className="text-[42px] font-black leading-none tracking-normal text-white drop-shadow-[0_3px_12px_rgba(0,0,0,0.28)] sm:text-5xl">
              登录
            </h1>
            <p className="mt-4 text-base font-medium text-white/88 sm:text-lg">
              欢迎回来，请登录你的账号
            </p>
          </div>

          <div className="space-y-4">
            <label className="sr-only" htmlFor="employeeId">
              工号
            </label>
            <div className="group flex h-16 items-center gap-3 rounded-2xl border border-white/36 bg-white/10 px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition focus-within:border-[#eff8b8]/90 focus-within:bg-white/18 focus-within:ring-4 focus-within:ring-[#eff8b8]/18">
              <svg
                className="h-6 w-6 shrink-0 text-white/76 transition group-focus-within:text-[#eff8b8]"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M20 21a8 8 0 0 0-16 0"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
              <input
                id="employeeId"
                type="text"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
                placeholder="工号"
                className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-white placeholder:text-white/68 focus:outline-none"
                autoFocus
                autoComplete="username"
              />
            </div>

            <label className="sr-only" htmlFor="password">
              密码
            </label>
            <div className="group flex h-16 items-center gap-3 rounded-2xl border border-white/36 bg-white/10 px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition focus-within:border-[#eff8b8]/90 focus-within:bg-white/18 focus-within:ring-4 focus-within:ring-[#eff8b8]/18">
              <svg
                className="h-6 w-6 shrink-0 text-white/76 transition group-focus-within:text-[#eff8b8]"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  width="16"
                  height="11"
                  x="4"
                  y="10"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M8 10V7a4 4 0 0 1 8 0v3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码"
                className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-white placeholder:text-white/68 focus:outline-none"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/78 transition hover:bg-white/14 hover:text-[#eff8b8] focus:outline-none focus:ring-2 focus:ring-[#eff8b8]/70"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? (
                  <svg
                    className="h-6 w-6"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 3l18 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M10.6 10.6a2 2 0 0 0 2.8 2.8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M9.9 5.2A9.5 9.5 0 0 1 12 5c5 0 8.5 4.2 9.7 6a1.8 1.8 0 0 1 0 2c-.5.8-1.4 1.8-2.5 2.8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M6.7 6.8A14.2 14.2 0 0 0 2.3 11a1.8 1.8 0 0 0 0 2C3.5 14.8 7 19 12 19c1.2 0 2.3-.2 3.3-.7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-6 w-6"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.3 11a1.8 1.8 0 0 0 0 2C3.5 14.8 7 19 12 19s8.5-4.2 9.7-6a1.8 1.8 0 0 0 0-2C20.5 9.2 17 5 12 5S3.5 9.2 2.3 11Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-white/88">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="peer sr-only"
              />
              <span className="grid h-7 w-7 place-items-center rounded-lg border border-white/46 bg-[#eef8bc]/28 text-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.42)] transition peer-checked:border-[#edf8b5] peer-checked:bg-[#edf8b5] peer-checked:text-[#35560e]">
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="m5 12 4 4L19 6"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              记住我
            </label>
            <span className="ml-auto text-xs font-medium text-white/66">
              默认密码: 123456
            </span>
          </div>

          {error && (
            <p
              className="mt-5 rounded-2xl border border-red-200/50 bg-red-500/18 px-4 py-3 text-center text-sm font-semibold text-red-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
              role="alert"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !employeeId || !password}
            className="mt-7 h-16 w-full rounded-2xl border border-white/48 bg-gradient-to-r from-[#dbe98a] via-[#9bb934] to-[#3d7109] text-xl font-black text-white shadow-[0_18px_38px_rgba(42,85,9,0.36),inset_0_1px_0_rgba(255,255,255,0.58)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_44px_rgba(42,85,9,0.44),inset_0_1px_0_rgba(255,255,255,0.62)] focus:outline-none focus:ring-4 focus:ring-[#eff8b8]/35 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
