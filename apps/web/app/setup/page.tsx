import Link from "next/link";
import { API } from "@/lib/api";
import "./setup.css";
export default function SetupGuide() {
  return (
    <main className="setup-guide">
      <Link href="/" className="back-link">
        ← Back to workspace
      </Link>
      <div className="eyebrow">CONNECT YOUR WORKSPACE</div>
      <h1>One-time service setup</h1>
      <p>
        Google registration and subscriptions use your own service accounts.
        Keep credentials in the server environment, then restart the API.
      </p>
      <section className="panel">
        <h2>Google sign-up and sign-in</h2>
        <ol>
          <li>
            Create a web OAuth client in Google Cloud and enable Google Auth
            Platform for your application.
          </li>
          <li>
            Register this redirect URI exactly:
            <code>{API}/api/v1/auth/google/callback</code>
          </li>
          <li>
            Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>
            , and <code>GOOGLE_REDIRECT_URI</code> in the repository’s{" "}
            <code>.env</code> file.
          </li>
          <li>
            Restart the API. “Sign up with Google” becomes active. Google
            creates the user profile and workspace automatically.
          </li>
        </ol>
        <p>
          Existing users can connect Google from My profile. Google test-mode
          apps may require adding the account as a test user.
        </p>
      </section>
      <section className="panel">
        <h2>Subscriptions</h2>
        <ol>
          <li>In Stripe test mode, create recurring Pro and Team prices.</li>
          <li>
            Set <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_PRO_PRICE_ID</code>
            , and <code>STRIPE_TEAM_PRICE_ID</code>.
          </li>
          <li>
            Forward checkout and subscription events to{" "}
            <code>{API}/api/v1/webhooks/stripe</code>, and set{" "}
            <code>STRIPE_WEBHOOK_SECRET</code> to the endpoint’s signing secret.
          </li>
          <li>
            Restart the API. Subscribe from Usage & billing. The account plan
            changes after a verified Stripe event.
          </li>
        </ol>
        <p>
          Use Stripe’s customer portal to change or cancel an existing
          subscription. Configure the portal’s product catalog for both paid
          plans.
        </p>
      </section>
      <section className="panel">
        <h2>Workflow API credentials</h2>
        <p>
          Configure an API node’s URL, method, optional authorization and JSON
          body. Capture nodes provide variables such as{" "}
          <code>{"{{order_id}}"}</code>; API results can be used as{" "}
          <code>{"{{api_result.data.status}}"}</code>.
        </p>
        <p>
          Authorization is encrypted when saved. Local development generates a
          persistent key in <code>data/workflow-encryption.key</code>.
          Production requires a stable <code>WORKFLOW_ENCRYPTION_KEY</code>.
          Preserve this key when redeploying.
        </p>
        <p>
          Connect Success and Error routes, test the draft in Emulator, and
          publish the workflow. Your agent’s hosted and embedded chat then use
          that published version. Disable the workflow to return to standard
          knowledge-base chat.
        </p>
      </section>
    </main>
  );
}
