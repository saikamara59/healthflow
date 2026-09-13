/**
 * Canonical HealthFlow wordmark.
 *
 * "Health" inherits the surrounding text color so it adapts to any surface;
 * "Flow" always carries the teal-to-cyan brand gradient. Set in DM Sans
 * to pair with the BrandLogo mark. Reuse this everywhere the name appears so
 * the Health/Flow split and gradient stay consistent; never hand-type the
 * word with a one-off font class.
 *
 * Sizing/color come from the caller (a className or inline style), so this
 * drops into the sidebar, login, and landing without prescribing a size.
 */
export default function BrandWordmark({ className = '', style }) {
  return (
    <span className={`hf-wordmark ${className}`.trim()} style={style}>
      Health<span className="hf-wordmark-flow">Flow</span>
    </span>
  );
}
