import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

/**
 * Remotion entry point. The bundler starts here; it registers the Root that
 * declares the AutoDemo composition.
 */
registerRoot(RemotionRoot);
