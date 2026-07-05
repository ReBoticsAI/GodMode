import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";

export default ReactDOM;

export const {
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  unstable_batchedUpdates,
  useFormState,
  useFormStatus,
  version,
} = ReactDOM;

export const { createRoot, hydrateRoot } = ReactDOMClient;
