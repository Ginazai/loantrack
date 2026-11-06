import { ArrowRight, Wallet } from "@carbon/icons-react";
import { Button, Form, InlineLoading, PasswordInput, TextInput, Theme } from "@carbon/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authApi } from "../../api";
import { Notice } from "../../components/feedback";
import { useAuthStore } from "../../stores/authStore";
import { getApiErrorMessage } from "../../utils/apiError";
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
      setError(getApiErrorMessage(e, "Login failed. Check your credentials."));
    }
  };

  return (
    <div className="lt-login">
      <Theme theme="g100" className="lt-login__brand">
        <div className="lt-login__wordmark">
          <span className="lt-login__mark" aria-hidden="true">
            <Wallet size={24} />
          </span>
          LoanTrack
        </div>

        <div>
          <blockquote className="lt-login__quote">
            “A promissory note is only as good as the system behind it.”
          </blockquote>
          <p className="lt-login__tagline">
            Private loan tracking · Interest calculator · Payment records
          </p>
        </div>

        <div className="lt-login__foot">
          <span>Secure</span>
          <span aria-hidden="true">·</span>
          <span>Private</span>
          <span aria-hidden="true">·</span>
          <span>Precise</span>
        </div>
      </Theme>

      <main className="lt-login__form-side">
        <div className="lt-login__form">
          <div className="lt-login__mobile-mark">
            <span className="lt-login__mark" aria-hidden="true">
              <Wallet size={24} />
            </span>
            LoanTrack
          </div>

          <h1 className="lt-login__title">Sign in</h1>
          <p className="lt-login__lede">Access your loan ledger</p>

          {error && (
            <div className="lt-mb-lg">
              <Notice kind="error" title="Sign-in failed">
                {error}
              </Notice>
            </div>
          )}

          <Form onSubmit={handleSubmit(onSubmit)} noValidate className="lt-form">
            <TextInput
              id="login-email"
              type="email"
              labelText="Email"
              placeholder="you@example.com"
              autoComplete="email"
              invalid={!!errors.email}
              invalidText={errors.email?.message}
              {...register("email")}
            />
            <PasswordInput
              id="login-password"
              labelText="Password"
              placeholder="••••••••"
              autoComplete="current-password"
              invalid={!!errors.password}
              invalidText={errors.password?.message}
              {...register("password")}
            />
            <Button
              type="submit"
              size="lg"
              className="lt-login__submit"
              renderIcon={isSubmitting ? undefined : ArrowRight}
              disabled={isSubmitting}
            >
              {isSubmitting ? <InlineLoading description="Signing in…" /> : "Sign in"}
            </Button>
          </Form>

          <p className="lt-login__foot-note">Ledger v2 · Private use only</p>
        </div>
      </main>
    </div>
  );
}
