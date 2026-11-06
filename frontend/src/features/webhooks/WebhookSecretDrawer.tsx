import { Button, CodeSnippet, Layer } from "@carbon/react";
import { Drawer, Notice } from "../../components/common";

const VERIFY_SNIPPET = `// Node.js — verify against the RAW request body, exactly as received
const crypto = require("crypto");

function isFromLoanTrack(rawBody, signatureHeader, secret) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return (
    signatureHeader.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected))
  );
}`;

interface Props {
  secret: string;
  targetUrl: string;
  /** True when this is a replacement secret from "Rotate secret". */
  rotated?: boolean;
  onClose: () => void;
}

/**
 * The one place a webhook's signing secret is ever shown. The server returns it only in the
 * response to create / rotate and never again (like an API key), so this must be copied now.
 */
export function WebhookSecretDrawer({ secret, targetUrl, rotated = false, onClose }: Props) {
  return (
    <Drawer
      title={rotated ? "New signing secret" : "Webhook signing secret"}
      subtitle={targetUrl}
      onClose={onClose}
      width="lg"
    >
      <div className="lt-form">
        <Notice kind="warning" title="Copy it now — it won't be shown again">
          {rotated
            ? "The previous secret has stopped working. Update your receiving workflow with this one."
            : "Your receiving workflow needs this secret to check that a request really came from LoanTrack."}{" "}
          If you lose it, you can rotate to get a new one.
        </Notice>

        <div>
          <p className="cds--label">Signing secret</p>
          <Layer>
            <CodeSnippet type="single" feedback="Copied" aria-label="Webhook signing secret">
              {secret}
            </CodeSnippet>
          </Layer>
        </div>

        <div>
          <p className="cds--label">How to verify a request</p>
          <p className="lt-field-note lt-mb-md">
            Each request carries <code>X-Webhook-Signature</code>: the hex HMAC-SHA256 of the raw
            request body, keyed with this secret. Compare it in constant time, and use{" "}
            <code>X-Webhook-Id</code> to ignore a delivery you already handled.
          </p>
          <Layer>
            <CodeSnippet type="multi" feedback="Copied" wrapText>
              {VERIFY_SNIPPET}
            </CodeSnippet>
          </Layer>
        </div>

        <div className="lt-form__actions lt-form__actions--bleed">
          <Button type="button" size="lg" onClick={onClose}>
            I've saved it
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
