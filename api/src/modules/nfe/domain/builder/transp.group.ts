import type { BuildContext, XmlNode } from './context';

/** `transp`: `modFrete` 9 (no freight); carrier and volumes are out of phase 1. */
export function transpGroup(_ctx: BuildContext): XmlNode {
  return { modFrete: 9 };
}
