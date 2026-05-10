import * as React from "react"
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { AuthFieldMessage, AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useOwnerSignupMutation } from "@/hooks/use-owner-api"
import {
  formatBangladeshPhonePlaceholder,
  isValidBangladeshPhone,
  normalizeBangladeshPhone,
  sanitizeBangladeshPhoneInput,
} from "@/lib/phone"
import type { RestaurantLifecycleStatus } from "@/store/app-store"
import { useAppStore } from "@/store/app-store"

function getPasswordStrengthLabel(password: string) {
  if (password.length >= 10) return "Strong"
  if (password.length >= 8) return "Good"
  if (password.length >= 6) return "Fair"
  return "Too short"
}

export function OwnerSignUpPage() {
  const navigate = useNavigate()
  const setOwnerAccount = useAppStore((state) => state.setOwnerAccount)
  const setVerificationModalOpen = useAppStore(
    (state) => state.setVerificationModalOpen
  )
  const setVerificationRequest = useAppStore(
    (state) => state.setVerificationRequest
  )
  const setRestaurantLifecycleStatus = useAppStore(
    (state) => state.setRestaurantLifecycleStatus
  )
  const setOnboardingState = useAppStore((state) => state.setOnboardingState)

  const [ownerName, setOwnerName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false)
  const [acceptedTerms, setAcceptedTerms] = React.useState(true)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitError, setSubmitError] = React.useState("")
  const ownerSignupMutation = useOwnerSignupMutation()
  const isLoading = ownerSignupMutation.isPending

  const passwordStrength = getPasswordStrengthLabel(password)
  const passwordProgress = Math.min(Math.round((password.length / 10) * 100), 100)

  function validate() {
    const nextErrors: Record<string, string> = {}
    const normalizedPhone = normalizeBangladeshPhone(phone)

    if (!ownerName.trim()) {
      nextErrors.ownerName = "Owner name is required."
    }

    if (!normalizedPhone) {
      nextErrors.phone = "Phone number is required."
    } else if (!isValidBangladeshPhone(normalizedPhone)) {
      nextErrors.phone = "Invalid phone number."
    }

    if (!password.trim()) {
      nextErrors.password = "Password is required."
    } else if (password.trim().length < 6) {
      nextErrors.password = "Password must be at least 6 characters."
    }

    if (!confirmPassword.trim()) {
      nextErrors.confirmPassword = "Please confirm the password."
    } else if (confirmPassword !== password) {
      nextErrors.confirmPassword = "Passwords do not match."
    }

    if (!acceptedTerms) {
      nextErrors.terms = "You need to accept the terms to continue."
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    if (!validate()) return
    const normalizedPhone = normalizeBangladeshPhone(phone)
    setSubmitError("")

    try {
      const result = await ownerSignupMutation.mutateAsync({
        fullName: ownerName.trim(),
        phone: normalizedPhone,
        password: password.trim(),
      })

      setOwnerAccount((current) => ({
        ...current,
        ownerName: ownerName.trim(),
        phone: normalizedPhone,
        email: "",
        profileImageUrl: "",
        createdAt: current.createdAt || new Date().toISOString(),
        lastLoginAt: null,
        isAuthenticated: false,
        isPhoneVerified: false,
      }))
      setRestaurantLifecycleStatus(result.nextStatus as RestaurantLifecycleStatus)
      setVerificationRequest({
        verificationSessionId: result.verificationSessionId,
        purpose: "owner_signup_verify",
        phone: normalizedPhone,
        referenceId: result.ownerId,
        pendingPassword: password.trim(),
      })
      setVerificationModalOpen(true)
      setOnboardingState((current) => ({
        ...current,
        currentStep: "basic_info",
        completedSteps: [],
        skippedSteps: [],
        draftSavedAt: null,
        submittedAt: null,
        reviewNote: "",
        reviewIssues: [],
        resubmissionCount: 0,
      }))

      toast.success("Account created. Verify the phone number to continue.")
      navigate("/auth/signup")
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to create the owner account right now."
      setSubmitError(message)

      toast.error("Account creation failed", {
        description: message,
      })
    }
  }

  return (
    <AuthShell
      title="Create your owner account"
      description="Start with the essentials. We will guide you through phone verification and onboarding next."
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/auth/signin"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="signup-owner-name">Full Name</Label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="signup-owner-name"
                autoFocus
                className="h-12 rounded-2xl pl-10"
                placeholder="Enter your full name"
                value={ownerName}
                onChange={(event) => {
                  setOwnerName(event.target.value)
                  if (errors.ownerName || submitError) {
                    setErrors((current) => ({ ...current, ownerName: "" }))
                    setSubmitError("")
                  }
                }}
                aria-invalid={!!errors.ownerName}
              />
            </div>
            <AuthFieldMessage error={errors.ownerName} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signup-phone">Phone Number</Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="signup-phone"
                className="h-12 rounded-2xl pl-10"
                inputMode="numeric"
                maxLength={11}
                placeholder={formatBangladeshPhonePlaceholder()}
                value={phone}
                onChange={(event) => {
                  setPhone(sanitizeBangladeshPhoneInput(event.target.value))
                  if (errors.phone || submitError) {
                    setErrors((current) => ({ ...current, phone: "" }))
                    setSubmitError("")
                  }
                }}
                aria-invalid={!!errors.phone}
              />
            </div>
            <AuthFieldMessage error={errors.phone} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signup-password">Password</Label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="signup-password"
                type={showPassword ? "text" : "password"}
                className="h-12 rounded-2xl pl-10 pr-11"
                placeholder="At least 6 characters"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  if (errors.password || submitError) {
                    setErrors((current) => ({ ...current, password: "" }))
                    setSubmitError("")
                  }
                }}
                aria-invalid={!!errors.password}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <AuthFieldMessage error={errors.password} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signup-confirm-password">Confirm Password</Label>
            <div className="relative">
              <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="signup-confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                className="h-12 rounded-2xl pl-10 pr-11"
                placeholder="Repeat the password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value)
                  if (errors.confirmPassword || submitError) {
                    setErrors((current) => ({ ...current, confirmPassword: "" }))
                    setSubmitError("")
                  }
                }}
                aria-invalid={!!errors.confirmPassword}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                aria-label={
                  showConfirmPassword ? "Hide confirm password" : "Show confirm password"
                }
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <AuthFieldMessage error={errors.confirmPassword} />
          </div>
        </div>

        <div className="rounded-2xl border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Password strength</p>
            <p className="text-sm text-muted-foreground">{passwordStrength}</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${passwordProgress}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Use at least 8 characters for a stronger password.
          </p>
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-3 rounded-2xl border bg-muted/20 px-4 py-3 text-sm">
            <Checkbox
              checked={acceptedTerms}
              onCheckedChange={(checked) => setAcceptedTerms(Boolean(checked))}
              className="mt-0.5"
            />
            <span className="leading-6 text-muted-foreground">
              I agree to the{" "}
              <Link
                to="/terms-and-conditions"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Terms & Conditions
              </Link>{" "}
              and{" "}
              <Link
                to="/privacy-policy"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          <AuthFieldMessage error={errors.terms} />
        </div>

        <AuthFieldMessage
          error={submitError}
          className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm"
        />

        <Button
          type="submit"
          className="h-12 w-full rounded-2xl"
          disabled={isLoading}
        >
          {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {isLoading ? "Creating Account..." : "Create Account"}
          {!isLoading ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
        </Button>

        <p className="text-center text-xs leading-5 text-muted-foreground">
          Your phone stays the only sign-in and verification method for now.
        </p>
      </form>
    </AuthShell>
  )
}
