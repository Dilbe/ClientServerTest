// Zod can speed up checks by generating code at runtime (`new Function`, a
// form of eval). Our Content Security Policy forbids that, because eval is
// how injected text becomes running code. This turns the feature off. It must
// be imported before anything else uses Zod.

import { z } from "zod";

z.config({ jitless: true });
