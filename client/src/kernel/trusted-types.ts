// trusted-types.ts — Browser-native XSS mitigation via Trusted Types API.
//
// Defines a strict policy that escapes HTML and blocks script creation.
// Defense-in-depth complementing the kernel's sanitization pipeline:
// if any code path bypasses the kernel and attempts to inject HTML or
// create scripts via DOM sinks, Trusted Types will either escape it
// (createHTML) or throw (createScript, createScriptURL).
//
// Must be imported BEFORE any DOM manipulation (first import in main.tsx).
// The console.warn in createHTML is a security canary — it should NEVER
// fire in normal operation. If it does, a code path is writing raw HTML
// outside the kernel's sanitize → render pipeline.

if (typeof window !== 'undefined' && window.trustedTypes) {
  window.trustedTypes.createPolicy('discreet-default', {
    createHTML: (input: string) => {
      console.warn(
        '[SECURITY] Trusted Types policy invoked — ' +
          'code path bypassing kernel detected'
      );
      // Escape everything — this path should never execute in normal
      // operation. All content flows through the kernel's sanitization
      // and arrives as pre-escaped SanitizedContent in the render model.
      return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    },
    createScript: () => {
      throw new Error(
        '[SECURITY] Script creation blocked by Trusted Types policy'
      );
    },
    createScriptURL: () => {
      throw new Error(
        '[SECURITY] Script URL creation blocked by Trusted Types policy'
      );
    },
  });
}
