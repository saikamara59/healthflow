import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import BrandLogo from '../components/ui/BrandLogo'
import BrandWordmark from '../components/ui/BrandWordmark'
import '../home-v2.css'
import '../login-v2.css'

/** Authenticates a broker and routes successful sign-ins to the workspace. */
export default function LoginPage() {
  const navigate = useNavigate()
  const { login, register } = useAuth()
  const [searchParams] = useSearchParams()

  // /login?mode=register lands directly in sign-up mode, used by the
  // landing page's "Request access" CTAs so visitors don't have to toggle.
  const [isRegisterMode, setIsRegisterMode] = useState(
    () => searchParams.get('mode') === 'register'
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  const switchMode = (register) => {
    setIsRegisterMode(register)
    setError('')
    setInfo('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    if (isRegisterMode) {
      const result = await register(email, password, fullName)
      setLoading(false)
      if (result.success) {
        // New accounts land pending admin approval — don't try to auto-login,
        // it would fail with the same pending message and confuse the user.
        setIsRegisterMode(false)
        setPassword('')
        setInfo(
          `Account created for ${email}. An admin will review your registration before you can sign in.`,
        )
      } else {
        setError(result.error || 'Registration failed')
      }
      return
    }

    const result = await login(email, password)
    setLoading(false)
    if (result.success) {
      navigate('/')
    } else {
      setError(result.error || 'Authentication failed')
    }
  }

  return (
    <div className="lp glassui auth-stage">
      {/* aurora backdrop — same engine as the v2 landing */}
      <div className="aurora" aria-hidden="true">
        <span className="blob b1"></span>
        <span className="blob b2"></span>
        <span className="blob b3"></span>
        <span className="blob b4"></span>
        <span className="grain"></span>
      </div>

      {/* top bar */}
      <nav className="auth-topbar">
        <Link className="lp-logo" to="/">
          <BrandLogo size={30} className="mk" />
          <BrandWordmark className="wm" />
        </Link>
        <Link className="auth-back" to="/">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 19l-7-7 7-7" /></svg>
          Back to site
        </Link>
      </nav>

      <main className="auth-main">
        <div className="auth-card glass-panel">
          {/* mode toggle */}
          <div className="auth-switch">
            <span
              className="auth-switch-pill"
              style={{ transform: isRegisterMode ? 'translateX(100%)' : 'translateX(0)' }}
            />
            <button
              type="button"
              className={`auth-switch-btn ${!isRegisterMode ? 'on' : ''}`}
              onClick={() => switchMode(false)}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`auth-switch-btn ${isRegisterMode ? 'on' : ''}`}
              onClick={() => switchMode(true)}
            >
              Sign up
            </button>
          </div>

          {error && (
            <div className="auth-alert err" role="alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></svg>
              <span>{error}</span>
            </div>
          )}
          {info && (
            <div className="auth-alert ok" role="status">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              <span>{info}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-eyebrow">{isRegisterMode ? 'Request access' : 'Welcome back'}</div>
            <h1 className="auth-title">
              {isRegisterMode ? 'Create your workspace' : 'Sign in to your workspace'}
            </h1>
            <p className="auth-sub">
              {isRegisterMode
                ? 'For licensed Medicare brokers and agencies.'
                : 'Pick up right where you left off.'}
            </p>

            {isRegisterMode && (
              <div className="g-field">
                <label htmlFor="su-name">Full name</label>
                <div className="g-input">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>
                  <input
                    id="su-name"
                    type="text"
                    placeholder="Jordan Avery"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            <div className="g-field">
              <label htmlFor="email">Work email</label>
              <div className="g-input">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                <input
                  id="email"
                  type="email"
                  placeholder="you@agency.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="g-field">
              <label htmlFor="password">
                Password
                {!isRegisterMode && <a href="#">Forgot?</a>}
              </label>
              <div className="g-input">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={isRegisterMode ? 'Create a password' : '••••••••••'}
                  autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isRegisterMode ? 12 : 8}
                />
                <button
                  type="button"
                  className="g-eye"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((s) => !s)}
                >
                  {showPassword ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9 9 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-2.16 3.19M6.6 6.6A18 18 0 0 0 2 12s3 8 10 8a9 9 0 0 0 5.4-1.6" /><path d="m2 2 20 20" /></svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>

            {isRegisterMode && (
              <div className="auth-reqs">
                <p>Password requirements</p>
                <ul>
                  <li>At least 12 characters long</li>
                  <li>Mix of letters and at least one number</li>
                  <li>At least one symbol (e.g. ! ? @ # $)</li>
                  <li>Not a commonly used password</li>
                </ul>
              </div>
            )}

            {isRegisterMode && (
              <label className="g-check">
                <input type="checkbox" required />
                <span>I'm a licensed agent and agree to the <a href="#">Terms</a> &amp; <a href="#">Privacy Policy</a>.</span>
              </label>
            )}

            <button className="lp-btn lg auth-submit" type="submit" disabled={loading}>
              {loading ? (
                'Processing…'
              ) : (
                <>
                  {isRegisterMode ? 'Create workspace' : 'Sign in'}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                </>
              )}
            </button>
          </form>

          <div className="auth-trust">
            <span>Sign in to your agency workspace.</span>
          </div>
        </div>
      </main>
    </div>
  )
}
