// HTTP headers that tell the browser to be stricter with our pages.

import type { NextFunction, Request, Response } from "express";

export function securityHeaders(production: boolean) {
  return (_request: Request, response: Response, next: NextFunction) => {
    // Don't guess file types: a file served as text is never run as a script.
    response.setHeader("X-Content-Type-Options", "nosniff");
    // Don't send our addresses to other websites when following a link.
    response.setHeader("Referrer-Policy", "same-origin");
    // Content Security Policy: the page may only load scripts, styles and
    // connections from our own address, and no other site may show our page
    // inside a frame (which could trick players into clicking things).
    // Development is left out: Vite's live reloading needs more freedom.
    if (production) {
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      );
    }
    next();
  };
}
