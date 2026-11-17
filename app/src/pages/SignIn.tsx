import { StageSlot } from "../components/Stage";
import { useApp } from "../state";

export function SignIn() {
  const { go } = useApp();
  const done = () => go("overview");
  return (
    <div className="signin">
      <div className="signin-art">
        <StageSlot id="signin-stage" interactive={false} spin />
        <blockquote>Know what's inside your PC, what's wrong with it and what to do next.</blockquote>
      </div>
      <div className="signin-form">
        <form onSubmit={(e) => { e.preventDefault(); done(); }}>
          <div className="brand" style={{ padding: 0, marginBottom: 8 }}><span className="brand-mark" />Rig</div>
          <h1>Sign in</h1>
          <p className="muted">Your PCs, their history and every change stay in sync between the app and the web.</p>
          <div className="field"><label className="label" htmlFor="email">Email</label><input className="input" id="email" type="email" placeholder="you@example.com" autoComplete="email" /></div>
          <button className="btn primary">Continue with email</button>
          <div className="or">or</div>
          <button className="btn" type="button" onClick={done}>Continue with Google</button>
          <button className="btn" type="button" onClick={done}>Continue with Apple</button>
          <p className="faint" style={{ fontSize: 12 }}>This is a mockup. Any button signs you in.</p>
        </form>
      </div>
    </div>
  );
}
