import { AlertTriangle, Wallet } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import type { LoginFormData } from "../../types";

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Required"),
});

export function LoginPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [error, setError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: LoginFormData) => {
    setError("");
    try {
      const tokens = await authApi.login(data);
      setTokens(tokens.access_token, tokens.refresh_token);
      const user = await authApi.me();
      setUser(user);
      navigate("/dashboard");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Login failed. Check your credentials.");
    }
  };

  return (
    <div className="min-h-screen flex ledger-bg bg-base-200">
      {/* Left panel — branding */}
      <div className="hidden lg:flex w-1/2 bg-neutral flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary rounded-md flex items-center justify-center">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-lg text-white">LoanTrack</span>
            <p className="text-xs text-white/30 font-mono tracking-widest uppercase">Ledger</p>
          </div>
        </div>

        <div>
          <blockquote className="text-3xl font-bold text-white/90 leading-snug mb-4">
            "A promissory note is only as good as the system behind it."
          </blockquote>
          <p className="text-sm text-white/40 font-mono">
            Private loan tracking · Interest calculator · Payment records
          </p>
        </div>

        <div className="flex gap-8 text-white/20 text-xs font-mono uppercase tracking-widest">
          <span>Secure</span>
          <span>·</span>
          <span>Private</span>
          <span>·</span>
          <span>Precise</span>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-9 h-9 bg-primary rounded-md flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl">LoanTrack</span>
          </div>

          <h2 className="text-xl font-bold mb-1">Sign in</h2>
          <p className="text-sm text-base-content/40 mb-8">Access your loan ledger</p>

          {error && (
            <div className="alert alert-error py-2.5 text-sm mb-5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text text-xs font-semibold uppercase tracking-wide">
                  Email
                </span>
              </label>
              <input
                type="email"
                className={`input input-bordered ${errors.email ? "input-error" : ""}`}
                placeholder="you@example.com"
                autoComplete="email"
                {...register("email")}
              />
              {errors.email && (
                <label className="label py-0.5">
                  <span className="label-text-alt text-error text-xs">{errors.email.message}</span>
                </label>
              )}
            </div>

            <div className="form-control">
              <label className="label py-1">
                <span className="label-text text-xs font-semibold uppercase tracking-wide">
                  Password
                </span>
              </label>
              <input
                type="password"
                className={`input input-bordered ${errors.password ? "input-error" : ""}`}
                placeholder="••••••••"
                autoComplete="current-password"
                {...register("password")}
              />
              {errors.password && (
                <label className="label py-0.5">
                  <span className="label-text-alt text-error text-xs">{errors.password.message}</span>
                </label>
              )}
            </div>

            <button
              type="submit"
              className={`btn btn-primary w-full mt-3 ${isSubmitting ? "loading" : ""}`}
            >
              Sign In
            </button>
          </form>

          <p className="text-center text-xs text-base-content/25 font-mono mt-10 uppercase tracking-widest">
            Ledger v2 · Private Use Only
          </p>
        </div>
      </div>
    </div>
  );
}
