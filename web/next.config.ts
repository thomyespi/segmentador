import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Panel interno: todas las páginas dependen de la sesión y de datos en vivo,
  // así que se usa el modelo de render dinámico clásico en vez de Cache Components.
  cacheComponents: false,
  experimental: {
    serverActions: {
      // La importación manda tandas de 500 contactos (Vercel corta en 4,5 MB).
      bodySizeLimit: "4mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
