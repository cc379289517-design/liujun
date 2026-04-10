"use client";

import { useState } from "react";
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      router.push(ROLE_REDIRECT[data.role] || "/photographer");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Logo & Title */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-[22px] bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg shadow-orange-200 mb-6">
            <span className="text-3xl text-white font-bold">S</span>
          </div>
          <h1 className="text-3xl font-bold text-[--text-primary] tracking-tight">
            SPAD
          </h1>
          <p className="text-[--text-secondary] mt-2 text-lg">
            摄影助理自动派单系统
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="card p-8 space-y-5">
          <div>
            <label className="block text-sm font-medium text-[--text-secondary] mb-1.5">
              工号
            </label>
            <input
              type="text"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
              placeholder="请输入工号"
              className="w-full px-4 py-2.5 rounded-xl border border-[--border] bg-[--bg-main] text-[--text-primary] placeholder:text-[--text-muted] focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[--text-secondary] mb-1.5">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              className="w-full px-4 py-2.5 rounded-xl border border-[--border] bg-[--bg-main] text-[--text-primary] placeholder:text-[--text-muted] focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !employeeId || !password}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-orange-400 to-orange-600 text-white font-medium shadow-md shadow-orange-200 hover:shadow-lg hover:shadow-orange-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "登录中..." : "登 录"}
          </button>

          <p className="text-xs text-[--text-muted] text-center">
            默认密码: 123456
          </p>
        </form>
      </div>
    </div>
  );
}
